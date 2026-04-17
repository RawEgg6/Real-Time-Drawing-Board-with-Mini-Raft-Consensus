const express = require("express")
const WebSocket = require("ws")
const cors = require("cors")
const axios = require("axios")
const path = require("path")
const fs = require("fs")

const app = express()
app.use(cors())

const frontendDirCandidates = [
  path.join(__dirname, "frontend"),
  path.resolve(__dirname, "../frontend")
]

const frontendDir = frontendDirCandidates.find((dirPath) =>
  fs.existsSync(path.join(dirPath, "index.html"))
)

if (frontendDir) {
  app.use("/frontend", express.static(frontendDir))
}

const PORT = Number(process.env.PORT || 3000)

const REPLICAS = (process.env.REPLICAS || "http://localhost:4001,http://localhost:4002,http://localhost:4003")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean)

// 🔍 Find current leader
async function findLeader() {
  for (const replica of REPLICAS) {
    try {
      const res = await axios.get(replica + "/status")

      if (res.data.state === "leader") {
        return replica
      }
    } catch {
      // ignore dead replicas
    }
  }

  throw new Error("No leader available")
}

// ✅ Send stroke and ensure COMMIT
async function sendToLeader(stroke) {
  const leader = await findLeader()

  const res = await axios.post(leader + "/stroke", {
    entry: stroke
  })

  if (!res.data || !res.data.committed) {
    throw new Error("Stroke not committed")
  }
}

// ✅ Clear board (leader only)
async function clearLeaderLog() {
  const leader = await findLeader()

  const res = await axios.post(leader + "/clear")

  if (!res.data || !res.data.committed) {
    throw new Error("Clear not committed")
  }
}

// ✅ Fetch log (any replica)
async function getStrokeLog() {
  for (const replica of REPLICAS) {
    try {
      const res = await axios.get(replica + "/log")
      return res.data.log || []
    } catch {}
  }
  return []
}

const server = app.listen(PORT, () => {
  console.log("Gateway running on port", PORT)
})

const wss = new WebSocket.Server({ server })

function broadcastStroke(stroke, excludeClient) {
  wss.clients.forEach(client => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(stroke))
    }
  })
}

wss.on("connection", async (ws) => {
  console.log("Client connected")

  // ✅ Send current CRDT state
  const strokes = await getStrokeLog()
  ws.send(JSON.stringify({
    type: "init",
    strokes
  }))

  ws.on("message", async (message) => {
    let payload

    try {
      payload = JSON.parse(message)
    } catch {
      console.error("Invalid websocket payload")
      return
    }

    // ✅ SINGLE STROKE (STRICT VALIDATION)
    if (
      payload.type === "stroke" &&
      payload.id &&
      payload.userId &&
      typeof payload.seq === "number"
    ) {
      try {
        await sendToLeader(payload)
        broadcastStroke(payload, ws)
      } catch (err) {
        console.error("Failed to process stroke:", err.message)
      }

      return
    }

    // ✅ BATCH STROKES (OFFLINE SYNC)
    if (payload.type === "batch" && Array.isArray(payload.strokes)) {
      for (const stroke of payload.strokes) {
        if (
          !stroke ||
          stroke.type !== "stroke" ||
          !stroke.id ||
          !stroke.userId ||
          typeof stroke.seq !== "number"
        ) {
          continue
        }

        try {
          await sendToLeader(stroke)
          broadcastStroke(stroke, ws)
        } catch (err) {
          console.error("Failed queued stroke:", err.message)
        }
      }

      return
    }

    // ✅ CLEAR BOARD
    if (payload.type === "clear") {
      try {
        await clearLeaderLog()
        broadcastStroke({ type: "clear" })
      } catch (err) {
        console.error("Failed to clear board:", err.message)
      }

      return
    }
  })

  ws.on("close", () => {
    console.log("Client disconnected")
  })
})