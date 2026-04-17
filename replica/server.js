const express = require("express")
const StrokeLog = require("./log")

const app = express()
app.use(express.json({ limit: "10mb" }))

const REPLICA_ID = process.env.REPLICA_ID || "replica1"
const PORT = Number(process.env.PORT || 4001)
const IS_LEADER = String(process.env.IS_LEADER || "false").toLowerCase() === "true"
const PEERS = (process.env.PEERS || "")
    .split(",")
    .map(p => p.trim())
    .filter(Boolean)

const strokeLog = new StrokeLog()

let state = IS_LEADER ? "leader" : "follower"
let currentLeader = IS_LEADER ? REPLICA_ID : null
let prevLeader = null
let lastHeartbeat = Date.now()

// 🔥 tuned (less spam)
const HEARTBEAT_INTERVAL = 2000
const HEARTBEAT_TIMEOUT = 7000
const SYNC_INTERVAL = 6000

// 🧠 logger
function log(msg) {
    console.log(`${REPLICA_ID} | ${msg}`)
}

// 🔁 state change
function setState(newState) {
    if (state !== newState) {
        state = newState

        if (state === "leader") {
            log(`[LEADER] I am the leader`)
        } else {
            log(`[FOLLOWER] Current leader: ${currentLeader}`)
        }
    }
}

// ✅ CRDT replication
async function replicateToFollowers(entry) {
    if (PEERS.length === 0) return []

    return Promise.all(
        PEERS.map(async (peer) => {
            try {
                await fetch(`${peer}/merge`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ strokes: [entry] })
                })
                return { success: true }
            } catch {
                return { success: false }
            }
        })
    )
}

// CLEAR
async function clearFollowersLog() {
    if (PEERS.length === 0) return []

    return Promise.all(
        PEERS.map(async (peer) => {
            try {
                await fetch(`${peer}/sync-log`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ entries: [] })
                })
                return { success: true }
            } catch {
                return { success: false }
            }
        })
    )
}

// 🟢 LEADER WRITE
app.post("/stroke", async (req, res) => {
    if (state !== "leader") {
        return res.status(400).json({ error: "Not leader" })
    }

    const { entry } = req.body || {}
    if (!entry || !entry.id) {
        return res.status(400).json({ error: "Invalid stroke" })
    }

    strokeLog.merge([entry])

    const results = await replicateToFollowers(entry)

    const success = results.filter(r => r.success).length + 1
    const majority = Math.floor((PEERS.length + 1) / 2) + 1

    if (success >= majority) {
        return res.json({ committed: true })
    }

    return res.status(500).json({ error: "No majority" })
})

// CLEAR
app.post("/clear", async (req, res) => {
    if (state !== "leader") {
        return res.status(400).json({ error: "Not leader" })
    }

    strokeLog.replaceAll([])
    await clearFollowersLog()

    return res.json({ committed: true })
})

// CRDT MERGE
app.post("/merge", (req, res) => {
    const { strokes } = req.body || {}

    if (!Array.isArray(strokes)) {
        return res.status(400).json({ error: "Invalid payload" })
    }

    strokeLog.merge(strokes)
    return res.json({ success: true })
})

// READ
app.get("/log", (req, res) => {
    res.json({
        replicaId: REPLICA_ID,
        state,
        log: strokeLog.getAll()
    })
})

// SYNC
app.post("/sync-log", (req, res) => {
    const { entries } = req.body || {}

    if (!Array.isArray(entries)) {
        return res.status(400).json({ error: "Invalid entries" })
    }

    strokeLog.replaceAll(entries)
    return res.json({ success: true })
})

// 💓 HEARTBEAT
app.post("/heartbeat", (req, res) => {
    const { leaderId } = req.body

    if (state !== "leader") {
        if (currentLeader !== leaderId) {
            prevLeader = currentLeader
            currentLeader = leaderId

            log(`[FOLLOWER] Leader changed: ${prevLeader ?? "None"} → ${currentLeader}`)
            setState("follower")
        }

        lastHeartbeat = Date.now()
    }

    return res.json({ success: true })
})

// STATUS
app.get("/status", (req, res) => {
    res.json({ state })
})

// 💓 SEND HEARTBEATS (silent)
async function sendHeartbeats() {
    if (state !== "leader") return

    for (const peer of PEERS) {
        try {
            await fetch(`${peer}/heartbeat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leaderId: REPLICA_ID })
            })
        } catch {}
    }
}

// 🧠 FAILURE DETECTION
async function detectLeaderFailure() {
    if (state === "leader") return

    if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {

        log(`[ELECTION] Waiting for leader election...`)

        prevLeader = currentLeader
        currentLeader = REPLICA_ID

        log(`[LEADER CHANGE] ${prevLeader ?? "None"} → ${currentLeader}`)

        setState("leader")
        await sendHeartbeats()
    }
}

// 🔄 SYNC (silent)
async function syncFollowersLog() {
    if (state !== "leader") return

    const leaderLog = strokeLog.getAll()

    for (const peer of PEERS) {
        try {
            const res = await fetch(`${peer}/log`)
            if (!res.ok) continue

            const data = await res.json()

            if (data.log.length < leaderLog.length) {
                await fetch(`${peer}/sync-log`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ entries: leaderLog })
                })
            }
        } catch {}
    }
}

// 🚀 START
app.listen(PORT, () => {
    log(`[START] Running on port ${PORT}`)

    if (state === "leader") {
        log(`[LEADER] I am the leader`)
    }
})

// loops
setInterval(sendHeartbeats, HEARTBEAT_INTERVAL)
setInterval(detectLeaderFailure, 1000)
setInterval(syncFollowersLog, SYNC_INTERVAL)