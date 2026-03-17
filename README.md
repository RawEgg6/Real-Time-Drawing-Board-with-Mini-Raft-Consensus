# Distributed Real-Time Drawing Board with Mini-RAFT

## Project Context Document (For Developers & LLM Assistants)

---

# 1. Project Overview

This project implements a **Distributed Real-Time Drawing Board** similar to collaborative whiteboard tools.

Multiple users can draw simultaneously on a browser canvas, and all clients see updates in real time.

Unlike a typical web application, the backend is designed as a **distributed system** consisting of:

* A **Gateway WebSocket server**
* **Three replica nodes** that maintain replicated state
* A **Mini-RAFT consensus protocol** to maintain consistency

The system must remain **available and consistent even if replicas restart or fail**.

---

# 2. Current Implementation Status

## Phase 1 — Completed

Phase 1 implemented a **basic collaborative drawing board using WebSockets**.

### Architecture

Clients communicate directly with the Gateway server.

```
Browser Client
      │
      │ WebSocket
      ▼
Gateway Server (Node.js)
      │
      └── Broadcast strokes to all clients
```

### Behavior

1. Users draw on an HTML canvas.
2. The browser sends stroke events to the Gateway via WebSocket.
3. The Gateway broadcasts strokes to all connected clients.
4. All clients render strokes in real time.

### Important Design Choice

The system stores drawing data as **stroke commands**, not pixels.

Example stroke event:

```
{
  "type": "stroke",
  "tool": "brush",
  "color": "#000000",
  "size": 2,
  "x0": 100,
  "y0": 120,
  "x1": 130,
  "y1": 150
}
```

This design makes replication and ordering possible in later phases.

---

# 3. Phase 1 Code Structure

```
project-root
│
├── frontend
│   └── index.html
│
├── gateway
│   ├── server.js
│   └── package.json
│
└── README.md
```

### Frontend

* HTML canvas drawing
* Mouse-based stroke creation
* WebSocket communication
* Rendering received strokes

### Gateway

* Node.js server
* WebSocket handling
* Broadcasts stroke events to clients
* Stores stroke history

---

# 4. Limitations of Phase 1

The system currently has **no fault tolerance**.

Problems:

* Gateway stores the drawing state.
* If the server crashes, all drawing history is lost.
* No replication exists.
* No leader election exists.

Therefore Phase 2 introduces **replicated state nodes**.

---

# 5. Phase 2 — Replicated Stroke Log (✅ Completed)

## Objective

Move stroke storage away from the Gateway into **replica nodes**.

The Gateway will act only as a **communication layer**.

### New Architecture

```
Clients
   │
   │ WebSocket
   ▼
Gateway
   │
   │ HTTP
   ▼
Leader Replica
   │
   ├── Follower Replica
   └── Follower Replica
```

### Behavior

1. Client sends stroke to Gateway.
2. Gateway forwards stroke to **Leader Replica**.
3. Leader appends stroke to its log.
4. Leader replicates stroke to followers.
5. All replicas maintain identical logs.

This phase **does not implement RAFT yet**.

Leader is **hardcoded** for now.

---

# 6. Phase 2 Components

## Replica Nodes

Three replicas will run as separate services.

Each replica maintains:

```
stroke_log = [entry1, entry2, entry3...]
```

Example log entry:

```
{
  type: "stroke",
  tool: "brush",
  color: "#000000",
  size: 2,
  x0: 10,
  y0: 20,
  x1: 30,
  y1: 40
}
```

---

## Replica API Endpoints

### POST /stroke

Used by Gateway to submit new strokes to the **leader**.

Leader behavior:

1. Append entry to local log
2. Replicate entry to followers
3. Respond success

---

### POST /append-entry

Used by the leader to replicate log entries to followers.

Follower behavior:

1. Append entry to log
2. Respond success

---

### GET /log

Returns the full log stored by that replica.

Used for debugging and testing replication correctness.

---

# 7. Phase 2 Tasks for Team Members

## Task A — Implement Replica Service

Responsibilities:

* Create `replica/` directory
* Implement log storage class
* Implement HTTP server
* Implement replication logic

Expected structure:

```
replica
│
├── server.js
├── log.js
└── package.json
```

---

## Task B — Modify Gateway

Responsibilities:

* Remove local stroke storage
* Forward strokes to leader replica
* Broadcast strokes to WebSocket clients

---

## Task C — Test Replication

Run 3 replicas and verify:

```
Replica1 log == Replica2 log == Replica3 log
```

Test procedure:

1. Start all replicas
2. Draw strokes
3. Query logs

Example:

```
curl localhost:4001/log
curl localhost:4002/log
curl localhost:4003/log
```

---

# 8. Phase 3 — Leader Election (Mini RAFT)

Phase 3 introduces **RAFT-like consensus behavior**.

Replica states:

```
Follower
Candidate
Leader
```

### Behavior

If followers stop receiving heartbeats:

```
Follower → Candidate
```

Candidate requests votes from other nodes.

If majority votes received:

```
Candidate → Leader
```

---

# 9. Phase 4 — Heartbeats and Failover

Leader periodically sends:

```
heartbeat messages
```

Followers reset their election timers when heartbeats arrive.

If leader fails:

```
new election occurs
new leader chosen
```

Gateway must automatically route traffic to the new leader.

---

# 10. Phase 5 — Log Commit & Majority Quorum

Entries are considered **committed only after majority replication**.

For 3 replicas:

```
majority = 2
```

Leader must receive acknowledgments from at least **two replicas** before committing entries.

---

# 11. Phase 6 — Restart & Log Synchronization

If a replica restarts:

1. It starts with empty log.
2. Leader sends missing entries.
3. Replica catches up with cluster state.

Endpoint used:

```
POST /sync-log
```

---

# 12. Phase 7 — Docker Deployment

Final architecture runs in containers:

```
gateway
replica1
replica2
replica3
```

Docker Compose responsibilities:

* start all services
* configure networking
* assign replica IDs
* enable bind mounts for hot reload

---

# 13. Phase 8 — Chaos Testing

Test system under failures:

* kill leader container
* restart follower
* edit code to trigger hot reload
* open multiple browser clients

Expected behavior:

* system remains available
* logs remain consistent
* new leader elected automatically

---

# 14. Final System Architecture

```
      Browser Clients
            │
            │ WebSocket
            ▼
         Gateway
            │
            │ HTTP RPC
            ▼
      RAFT Replica Cluster
        │          │
        ▼          ▼
    Replica2    Replica3
```

---

# 15. Key Concepts Being Implemented

This project demonstrates real-world distributed systems concepts:

* replicated logs
* leader election
* majority quorum
* failover recovery
* event sourcing
* containerized microservices
* real-time collaborative systems

---

# 16. Guidance for LLM Assistants

If an AI assistant is helping with this project, it should assume:

* the system is written in **Node.js**
* WebSockets are used for client communication
* replicas communicate via **HTTP RPC**
* state is stored as a **stroke command log**
* a simplified **RAFT protocol** will be implemented

The assistant should help implement features **incrementally across phases** without skipping earlier stages.
