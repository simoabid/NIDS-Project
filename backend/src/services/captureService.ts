// ─────────────────────────────────────────────────────────────────────────────
// Traffic Capture Service — Suricata → Redis Streams
// backend/src/services/captureService.ts
//
// Suricata writes all network events to eve.json (one JSON object per line).
// This service tails that file in real-time, extracts the features the ML
// model needs, and publishes them to the `traffic:raw` Redis Stream.
//
// Two modes:
//   1. Live capture  — spawn Suricata on an interface, tail eve.json
//   2. Pcap replay   — run Suricata against an uploaded .pcap, tail output
//
// The AI service's Redis consumer picks up from the stream automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import os from 'node:os'
import crypto from 'node:crypto'
import redis from '../config/redis.js'
import logger from '../config/logger.js'
import type { CaptureStatusPayload } from '../types/events.js'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const STREAM_KEY      = process.env['REDIS_STREAM_KEY']   ?? 'traffic:raw'
const EVE_LOG_DIR     = process.env['SURICATA_EVE_DIR']   ?? '/var/log/suricata'
const SURICATA_BIN    = process.env['SURICATA_BIN']       ?? '/usr/bin/suricata'

/** Set CAPTURE_MODE=pcap in .env to replay a pcap file instead of live capture */
const CAPTURE_MODE    = process.env['CAPTURE_MODE']       ?? 'live'
/** Path to the default pcap file for dev replay (used when CAPTURE_MODE=pcap) */
const CAPTURE_PCAP    = process.env['CAPTURE_PCAP_PATH']  ?? ''

/** Max entries in the Redis stream before XTRIM eviction */
const STREAM_MAX_LEN = 10_000

// ─────────────────────────────────────────────────────────────────────────────
// NSL-KDD Feature Mapping — Suricata eve.json → 41 model features
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map well-known port numbers to NSL-KDD service names.
 * The model was trained with these exact strings as categorical values.
 */
const PORT_TO_SERVICE: Record<number, string> = {
  20: 'ftp_data', 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp',
  37: 'time', 42: 'name', 43: 'whois', 53: 'domain_u', 66: 'sql_net',
  67: 'urh_i', 70: 'gopher', 79: 'finger', 80: 'http', 87: 'link',
  95: 'supdup', 101: 'hostnames', 102: 'iso_tsap', 105: 'csnet_ns',
  109: 'pop_2', 110: 'pop_3', 111: 'sunrpc', 113: 'auth', 115: 'sftp',
  117: 'uucp_path', 119: 'nntp', 123: 'ntp_u', 137: 'netbios_ns',
  138: 'netbios_dgm', 139: 'netbios_ssn', 143: 'imap4', 179: 'bgp',
  194: 'IRC', 389: 'ldap', 443: 'http', 445: 'netbios_ssn',
  513: 'login', 514: 'shell', 515: 'printer', 520: 'efs',
  530: 'courier', 540: 'uucp', 543: 'klogin', 544: 'kshell',
  993: 'imap4', 995: 'pop_3', 1080: 'http', 1433: 'sql_net',
  3306: 'sql_net', 5432: 'sql_net', 8080: 'http', 8443: 'http',
}

/**
 * Derive the NSL-KDD TCP flag label from Suricata's TCP + flow state.
 *
 * NSL-KDD flag values:
 *   SF  — normal SYN→SYN/ACK→ACK→FIN flow (completed)
 *   S0  — SYN sent, no reply at all
 *   REJ — connection rejected (RST after SYN)
 *   RSTO — originator sent RST
 *   RSTR — responder sent RST
 *   S1  — SYN exchanged, connection established, no FIN
 *   S2  — connection established, FIN from originator only
 *   S3  — connection established, FIN from responder only
 *   OTH — other/midstream
 */
function deriveFlag(
  proto: string,
  flowState: string | undefined,
  tcp: Record<string, unknown> | undefined,
): string {
  if (proto !== 'TCP') return 'SF'  // UDP/ICMP → treat as complete

  const state = (flowState ?? '').toLowerCase()
  const hasSyn = tcp?.['syn'] === true
  const hasFin = tcp?.['fin'] === true
  const hasRst = tcp?.['rst'] === true

  if (hasRst && hasSyn && !hasFin)   return 'REJ'
  if (hasRst)                         return 'RSTO'
  if (state === 'closed' && hasFin)   return 'SF'
  if (state === 'closed')             return 'SF'
  if (state === 'new' || (hasSyn && !hasFin && !hasRst)) return 'S0'
  if (state === 'established')        return 'S1'
  return 'OTH'
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection Tracker — sliding window for statistical features
// ─────────────────────────────────────────────────────────────────────────────

interface RecentFlow {
  destIp: string
  destPort: number
  service: string
  flag: string
  timestamp: number
}

/**
 * Tracks a 2-second sliding window of recent flows to compute the
 * NSL-KDD "same host" and "same service" statistical features:
 * count, srv_count, serror_rate, same_srv_rate, diff_srv_rate, etc.
 */
class ConnectionTracker {
  private readonly window: RecentFlow[] = []
  private readonly WINDOW_MS = 2_000   // 2 seconds, like NSL-KDD

  /** Record a flow and return computed statistics for it */
  track(flow: RecentFlow): Record<string, number> {
    const now = flow.timestamp
    // Evict expired entries
    while (this.window.length > 0 && (this.window[0]?.timestamp ?? 0) < now - this.WINDOW_MS) {
      this.window.shift()
    }
    this.window.push(flow)

    // ── "Same host" features (past 2s to same destIp) ───────────────────
    const sameHost = this.window.filter((f) => f.destIp === flow.destIp)
    const count = sameHost.length
    const sameService = sameHost.filter((f) => f.service === flow.service).length
    const diffService = count - sameService
    const synErrors = sameHost.filter((f) => f.flag === 'S0' || f.flag === 'REJ').length
    const rejErrors = sameHost.filter((f) => f.flag === 'REJ').length

    // ── "Same service" features (past 2s to same service) ───────────────
    const sameSrv = this.window.filter((f) => f.service === flow.service)
    const srvCount = sameSrv.length
    const srvSynErrors = sameSrv.filter((f) => f.flag === 'S0' || f.flag === 'REJ').length
    const srvRejErrors = sameSrv.filter((f) => f.flag === 'REJ').length
    const srvDiffHost = new Set(sameSrv.map((f) => f.destIp)).size

    // ── "dst_host_*" features (last 100 to same dest) ───────────────────
    const dstHostFlows = this.window.filter((f) => f.destIp === flow.destIp).slice(-100)
    const dstHostCount = dstHostFlows.length
    const dstHostSrvCount = dstHostFlows.filter((f) => f.service === flow.service).length
    const dstHostSameSrcPort = dstHostFlows.filter((f) => f.destPort === flow.destPort).length

    return {
      count,
      srv_count:               srvCount,
      serror_rate:             count > 0 ? synErrors / count : 0,
      srv_serror_rate:         srvCount > 0 ? srvSynErrors / srvCount : 0,
      rerror_rate:             count > 0 ? rejErrors / count : 0,
      srv_rerror_rate:         srvCount > 0 ? srvRejErrors / srvCount : 0,
      same_srv_rate:           count > 0 ? sameService / count : 0,
      diff_srv_rate:           count > 0 ? diffService / count : 0,
      srv_diff_host_rate:      srvCount > 0 ? srvDiffHost / srvCount : 0,
      dst_host_count:          dstHostCount,
      dst_host_srv_count:      dstHostSrvCount,
      dst_host_same_srv_rate:  dstHostCount > 0 ? dstHostSrvCount / dstHostCount : 0,
      dst_host_diff_srv_rate:  dstHostCount > 0 ? (dstHostCount - dstHostSrvCount) / dstHostCount : 0,
      dst_host_same_src_port_rate: dstHostCount > 0 ? dstHostSameSrcPort / dstHostCount : 0,
      dst_host_srv_diff_host_rate: dstHostSrvCount > 0
        ? new Set(dstHostFlows.filter((f) => f.service === flow.service).map((f) => f.destIp)).size / dstHostSrvCount
        : 0,
      dst_host_serror_rate:     dstHostCount > 0
        ? dstHostFlows.filter((f) => f.flag === 'S0' || f.flag === 'REJ').length / dstHostCount : 0,
      dst_host_srv_serror_rate: dstHostSrvCount > 0
        ? dstHostFlows.filter((f) => f.service === flow.service && (f.flag === 'S0' || f.flag === 'REJ')).length / dstHostSrvCount : 0,
      dst_host_rerror_rate:     dstHostCount > 0
        ? dstHostFlows.filter((f) => f.flag === 'REJ').length / dstHostCount : 0,
      dst_host_srv_rerror_rate: dstHostSrvCount > 0
        ? dstHostFlows.filter((f) => f.service === flow.service && f.flag === 'REJ').length / dstHostSrvCount : 0,
    }
  }

  reset(): void {
    this.window.length = 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Suricata eve.json → NSL-KDD feature vector
// ─────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type EveEvent = Record<string, any>
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Extract NSL-KDD features from a Suricata eve.json "flow" event.
 * Fields the model doesn't need default to 0 — the AI service's
 * dynamic feature alignment handles missing columns gracefully.
 */
function extractFeatures(
  eve: EveEvent,
  tracker: ConnectionTracker,
): Record<string, string | number> | null {
  // Only process flow events — they contain connection-level statistics
  if (eve['event_type'] !== 'flow') return null

  const flow = (eve['flow'] ?? {}) as Record<string, unknown>
  const tcp  = (eve['tcp']  ?? {}) as Record<string, unknown>
  const proto = String(eve['proto'] ?? 'TCP').toUpperCase()
  const destPort = Number(eve['dest_port'] ?? 0)
  const service = PORT_TO_SERVICE[destPort] ?? 'other'
  const flag = deriveFlag(proto, flow['state'] as string | undefined, tcp)

  // Map Suricata protocol names to NSL-KDD lowercase values
  const protoType = proto === 'TCP' ? 'tcp'
    : proto === 'UDP' ? 'udp'
    : proto === 'ICMP' ? 'icmp'
    : 'tcp'

  // ── Direct feature mapping ────────────────────────────────────────────
  const duration    = Number(flow['age'] ?? 0)
  const srcBytes    = Number(flow['bytes_toserver'] ?? 0)
  const dstBytes    = Number(flow['bytes_toclient'] ?? 0)
  const srcIp       = String(eve['src_ip']  ?? '0.0.0.0')
  const destIp      = String(eve['dest_ip'] ?? '0.0.0.0')
  const srcPort     = Number(eve['src_port'] ?? 0)
  const land        = (srcIp === destIp && srcPort === destPort) ? 1 : 0
  const urgent      = tcp?.['urg'] === true ? 1 : 0

  // ── Sliding-window statistical features ───────────────────────────────
  const stats = tracker.track({
    destIp,
    destPort,
    service,
    flag,
    timestamp: Date.now(),
  })

  // ── Compose the 41-feature vector ─────────────────────────────────────
  const features: Record<string, string | number> = {
    // Core connection features
    duration,
    protocol_type:       protoType,
    service,
    flag,
    src_bytes:           srcBytes,
    dst_bytes:           dstBytes,
    land,
    wrong_fragment:      0,        // not available from Suricata
    urgent,
    // Content features (not available — Suricata doesn't do payload inspection here)
    hot:                 0,
    num_failed_logins:   0,
    logged_in:           0,
    num_compromised:     0,
    root_shell:          0,
    su_attempted:        0,
    num_root:            0,
    num_file_creations:  0,
    num_shells:          0,
    num_access_files:    0,
    num_outbound_cmds:   0,
    is_host_login:       0,
    is_guest_login:      0,
    // Statistical features — computed by ConnectionTracker
    ...stats,
    // Metadata — not model features, but passed through for the AlertPayload
    sourceIp:            srcIp,
    destinationIp:       destIp,
    sourcePort:          srcPort,
    destinationPort:     destPort,
    protocol:            proto,
    packetSize:          srcBytes + dstBytes,
  }

  return features
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture Service — singleton that manages the Suricata lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureStats {
  flowsProcessed: number
  flowsPublished: number
  errors: number
  startedAt: string | null
  interface: string | null
  mode: 'live' | 'pcap' | 'idle'
}

class CaptureService {
  private _suricata: ChildProcess | null = null
  private _watcher: fs.FSWatcher | null = null
  private _tailAbort: AbortController | null = null
  private _tracker = new ConnectionTracker()
  private _stats: CaptureStats = {
    flowsProcessed: 0,
    flowsPublished: 0,
    errors: 0,
    startedAt: null,
    interface: null,
    mode: 'idle',
  }

  /** Check if CAPTURE_MODE=pcap is set for dev replay */
  get isPcapMode(): boolean {
    return CAPTURE_MODE === 'pcap'
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Start live capture on a network interface */
  async startLive(iface: string): Promise<void> {
    if (this._suricata) {
      throw new Error('Capture already running — stop it first')
    }

    const eveDir = path.join(os.tmpdir(), `suricata-nids-${Date.now()}`)
    fs.mkdirSync(eveDir, { recursive: true })
    const evePath = path.join(eveDir, 'eve.json')

    logger.info(`[Capture] Starting live capture on ${iface}, eve → ${evePath}`)

    // Spawn Suricata in IDS mode on the given interface
    // -l sets the log directory where eve.json will be written
    this._suricata = spawn(SURICATA_BIN, [
      '-c', '/etc/suricata/suricata.yaml',
      '-i', iface,
      '-l', eveDir,
      '--set', 'outputs.0.eve-log.filetype=regular',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this._suricata.stderr?.on('data', (chunk: Buffer) => {
      logger.debug(`[Suricata] ${chunk.toString().trim()}`)
    })

    this._suricata.on('error', (err) => {
      logger.error('[Capture] Suricata process error:', err)
      this._stats.errors++
    })

    this._suricata.on('exit', (code) => {
      logger.info(`[Capture] Suricata exited with code ${code ?? 'null'}`)
      this._suricata = null
    })

    this._stats = {
      flowsProcessed: 0, flowsPublished: 0, errors: 0,
      startedAt: new Date().toISOString(),
      interface: iface,
      mode: 'live',
    }
    this._tracker.reset()

    // Wait for eve.json to appear, then start tailing
    await this._waitForFile(evePath, 15_000)
    this._startTailing(evePath)
  }

  /** Process an uploaded .pcap file through Suricata */
  async processPcap(pcapPath: string): Promise<void> {
    if (this._suricata) {
      throw new Error('Capture already running — stop it first')
    }

    if (!fs.existsSync(pcapPath)) {
      throw new Error(`Pcap file not found: ${pcapPath}`)
    }

    const eveDir = path.join(os.tmpdir(), `suricata-pcap-${Date.now()}`)
    fs.mkdirSync(eveDir, { recursive: true })
    const evePath = path.join(eveDir, 'eve.json')

    logger.info(`[Capture] Processing pcap: ${pcapPath}, eve → ${evePath}`)

    // Suricata in pcap-read mode (offline)
    this._suricata = spawn(SURICATA_BIN, [
      '-c', '/etc/suricata/suricata.yaml',
      '-r', pcapPath,
      '-l', eveDir,
      '--set', 'outputs.0.eve-log.filetype=regular',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this._suricata.stderr?.on('data', (chunk: Buffer) => {
      logger.debug(`[Suricata] ${chunk.toString().trim()}`)
    })

    this._suricata.on('error', (err) => {
      logger.error('[Capture] Suricata pcap error:', err)
      this._stats.errors++
    })

    // When Suricata finishes the pcap, clean up
    this._suricata.on('exit', (code) => {
      logger.info(`[Capture] Suricata pcap finished with code ${code ?? 'null'}`)
      this._suricata = null
      // Give the tailer a moment to flush remaining lines, then stop
      setTimeout(() => {
        this._stopTailing()
        this._stats.mode = 'idle'
      }, 2_000)
    })

    this._stats = {
      flowsProcessed: 0, flowsPublished: 0, errors: 0,
      startedAt: new Date().toISOString(),
      interface: pcapPath,
      mode: 'pcap',
    }
    this._tracker.reset()

    await this._waitForFile(evePath, 15_000)
    this._startTailing(evePath)
  }

  /** Stop the active capture session */
  stop(): void {
    if (this._suricata) {
      logger.info('[Capture] Stopping Suricata…')
      this._suricata.kill('SIGTERM')
      // Force-kill after 5s if it doesn't exit cleanly
      const pid = this._suricata.pid
      setTimeout(() => {
        try {
          if (pid) process.kill(pid, 0) // check if still alive
          this._suricata?.kill('SIGKILL')
        } catch {
          // process already dead — fine
        }
      }, 5_000)
      this._suricata = null
    }

    this._stopTailing()
    this._stats.mode = 'idle'
    this._stats.interface = null
    logger.info(
      '[Capture] Stopped — processed: %d, published: %d, errors: %d',
      this._stats.flowsProcessed, this._stats.flowsPublished, this._stats.errors,
    )
  }

  /** Whether a capture session is currently running */
  get isActive(): boolean {
    return this._stats.mode !== 'idle'
  }

  /** Current capture statistics */
  get stats(): CaptureStats {
    return { ...this._stats }
  }

  /** Build a CaptureStatusPayload for Socket.io broadcast */
  get statusPayload(): CaptureStatusPayload {
    return {
      active:    this.isActive,
      interface: this._stats.interface,
      startedAt: this._stats.startedAt,
    }
  }

  // ── Private: eve.json tailing via fs.watch + readline ──────────────────

  private _startTailing(evePath: string): void {
    this._tailAbort = new AbortController()

    // Record the current file size so we only read NEW lines
    let position = 0
    try { position = fs.statSync(evePath).size } catch { /* empty */ }

    // fs.watch fires on every write Suricata makes to eve.json —
    // no polling, purely event-driven like `tail -f`.
    this._watcher = fs.watch(evePath, (eventType) => {
      if (eventType !== 'change') return
      if (this._tailAbort?.signal.aborted) return

      // Read only the bytes appended since our last read
      const stat = fs.statSync(evePath)
      if (stat.size <= position) return // truncation or no new data

      const stream = fs.createReadStream(evePath, {
        start: position,
        encoding: 'utf-8',
      })
      position = stat.size

      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

      rl.on('line', (line: string) => {
        if (!line.trim()) return
        try {
          const eve = JSON.parse(line) as EveEvent
          this._stats.flowsProcessed++

          const features = extractFeatures(eve, this._tracker)
          if (!features) return  // not a flow event — skip

          // Fire-and-forget publish — errors are counted, never thrown
          void this._publishToRedis(features).then(() => {
            this._stats.flowsPublished++
          }).catch((err: unknown) => {
            this._stats.errors++
            logger.error('[Capture] Redis publish error: %s', (err as Error).message)
          })
        } catch {
          // Malformed JSON — Suricata can emit partial writes at flush boundaries
          this._stats.errors++
        }
      })
    })

    logger.info('[Capture] fs.watch tailing %s (position: %d)', evePath, position)
  }

  private _stopTailing(): void {
    if (this._watcher) {
      this._watcher.close()
      this._watcher = null
    }
    if (this._tailAbort) {
      this._tailAbort.abort()
      this._tailAbort = null
    }
  }

  // ── Private: Redis publishing ──────────────────────────────────────────

  private async _publishToRedis(features: Record<string, string | number>): Promise<void> {
    const id = crypto.randomUUID()
    const timestamp = new Date().toISOString()

    // Flatten features to string pairs for XADD
    const fields: string[] = ['id', id, 'timestamp', timestamp]
    for (const [key, value] of Object.entries(features)) {
      fields.push(key, String(value))
    }

    // XADD with MAXLEN ~ to keep the stream bounded
    await redis.xadd(STREAM_KEY, 'MAXLEN', '~', String(STREAM_MAX_LEN), '*', ...fields)
  }

  // ── Private: utilities ─────────────────────────────────────────────────

  /** Wait for a file to appear on disk (Suricata takes a moment to start) */
  private async _waitForFile(filePath: string, timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (!fs.existsSync(filePath)) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for ${filePath} to appear`)
      }
      await this._sleep(200)
    }
    logger.info(`[Capture] eve.json found at ${filePath}`)
  }

  /** Abortable sleep */
  private _sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export — one capture session at a time
// ─────────────────────────────────────────────────────────────────────────────

const captureService = new CaptureService()
export default captureService
