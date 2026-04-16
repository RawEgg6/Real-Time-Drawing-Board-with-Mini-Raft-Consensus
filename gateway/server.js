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


/* async function sendToLeader(stroke) {
  for (const replica of REPLICAS) {
    try {
      await axios.post(replica + "/stroke", {
        entry: stroke
      })
      return // success → this is leader
    } catch (err) {
      // ignore non-leader errors
    }
  }

  throw new Error("No leader available")
} */

// phase 4
async function findLeader() {
  for (const replica of REPLICAS) {
    try {
      const res = await axios.get(replica + "/status")

      if (res.data.state === "leader") {
        return replica
      }
    } catch (err) {
      // ignore dead replicas
    }
  }

  throw new Error("No leader available")
}

async function sendToLeader(stroke) {
  const leader = await findLeader()

  await axios.post(leader + "/stroke", {
    entry: stroke
  })
}

async function clearLeaderLog() {
  const leader = await findLeader()
  await axios.post(leader + "/clear")
}

async function getStrokeLog() {
  for (const replica of REPLICAS) {
    try {
      const res = await axios.get(replica + "/log")
      return res.data.log || []
    } catch (err) {}
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

  // send existing strokes
  const strokes = await getStrokeLog()
  ws.send(JSON.stringify({
    type: "init",
    strokes
  }))

  ws.on("message", async (message) => {
    let payload

    try {
      payload = JSON.parse(message)
    } catch (err) {
      console.error("Invalid websocket payload")
      return
    }

    if (payload.type === "stroke") {
      try {
        await sendToLeader(payload)
        broadcastStroke(payload, ws)
      } catch (err) {
        console.error("Failed to process stroke:", err.message)
      }

      return
    }

    if (payload.type === "batch" && Array.isArray(payload.strokes)) {
      for (const stroke of payload.strokes) {
        if (!stroke || stroke.type !== "stroke") {
          continue
        }

        try {
          await sendToLeader(stroke)
          broadcastStroke(stroke, ws)
        } catch (err) {
          console.error("Failed to process queued stroke:", err.message)
        }
      }

      return
    }

    if (payload.type === "clear") {
      try {
        await clearLeaderLog()
        broadcastStroke({ type: "clear" })
      } catch (err) {
        console.error("Failed to clear board:", err.message)
      }
    }
  })

  ws.on("close", () => {
    console.log("Client disconnected")
  })
})