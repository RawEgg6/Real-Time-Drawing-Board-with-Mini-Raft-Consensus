const express = require("express")
const WebSocket = require("ws")
const cors = require("cors")
const axios = require("axios")

const app = express()
app.use(cors())

const PORT = 3000

const REPLICAS = [
  "http://localhost:4001",
  "http://localhost:4002",
  "http://localhost:4003"
]


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

function broadcastStroke(stroke) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
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
    const stroke = JSON.parse(message)

    if (stroke.type === "stroke") {
      try {
        await sendToLeader(stroke)
        broadcastStroke(stroke)
      } catch (err) {
        console.error("Failed to process stroke:", err.message)
      }
    }
  })

  ws.on("close", () => {
    console.log("Client disconnected")
  })
})