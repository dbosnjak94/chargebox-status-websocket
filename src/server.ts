// src/server.ts
import express from "express"
import { createServer } from "http"
import { WebSocketServer, WebSocket } from "ws"
import { chargingStations } from "./data/charging-stations-data"

interface Location {
  lat: string
  long: string
}

interface ChargerStatus {
  chargerId: number
  location: Location
  charger_type: string
  connector_status: string
}

interface WSMessage {
  type: "welcome" | "station_update" | "error"
  message?: string
  streamId?: number
  data?: ChargerStatus
}

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

// Track all active connections
const clients = new Set<WebSocket>()

// Heartbeat to detect stale connections
function heartbeat(ws: WebSocket) {
  const wsWithHeartbeat = ws as WebSocket & { isAlive: boolean }
  wsWithHeartbeat.isAlive = true
}

const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    const wsWithHeartbeat = ws as WebSocket & { isAlive: boolean }
    if (wsWithHeartbeat.isAlive === false) {
      return ws.terminate()
    }
    wsWithHeartbeat.isAlive = false
    ws.ping()
  })
}, 30000)

wss.on("connection", (ws: WebSocket) => {
  console.log("New client connected")
  clients.add(ws)

  const wsWithHeartbeat = ws as WebSocket & { isAlive: boolean }
  wsWithHeartbeat.isAlive = true

  // Handle pong messages for connection monitoring
  ws.on("pong", () => heartbeat(ws))

  // Send initial welcome message
  const welcomeMessage: WSMessage = {
    type: "welcome",
    message: "Connected to Charging Stations Stream",
  }
  ws.send(JSON.stringify(welcomeMessage))

  // Track stream state
  const streamState = {
    indexes: chargingStations.map(() => 0),
    intervals: [] as NodeJS.Timeout[],
  }

  // Set up parallel intervals for each station list
  streamState.intervals = chargingStations.map((stationList, streamId) => {
    return setInterval(() => {
      try {
        if (streamState.indexes[streamId] >= stationList.length) {
          streamState.indexes[streamId] = 0
        }

        const station = stationList[streamState.indexes[streamId]]
        const message: WSMessage = {
          type: "station_update",
          streamId,
          data: station,
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message))
        }

        streamState.indexes[streamId]++
      } catch (error) {
        const errorMessage: WSMessage = {
          type: "error",
          message: "Failed to send station update",
        }
        ws.send(JSON.stringify(errorMessage))
      }
    }, 2000)
  })

  // Handle client messages
  ws.on("message", (message: string) => {
    try {
      const parsedMessage = JSON.parse(message)
      // Handle any client messages here
      console.log("Received message:", parsedMessage)
    } catch (error) {
      console.error("Failed to parse client message:", error)
    }
  })

  // Handle client disconnection
  ws.on("close", () => {
    console.log("Client disconnected")
    clients.delete(ws)
    streamState.intervals.forEach(clearInterval)
  })

  // Handle errors
  ws.on("error", (error) => {
    console.error("WebSocket error:", error)
    clients.delete(ws)
    streamState.intervals.forEach(clearInterval)
  })
})

// Clean up on server shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing WebSocket server")
  clearInterval(pingInterval)
  wss.close(() => {
    console.log("WebSocket server closed")
    server.close(() => {
      console.log("HTTP server closed")
      process.exit(0)
    })
  })
})

const PORT = process.env.PORT || 8080
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
