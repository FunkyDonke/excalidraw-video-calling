import Peer, { DataConnection } from "peerjs";

type SocketId = string;

export class PeerJSSocket {
  public id: string;
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private listeners: Map<string, Function[]> = new Map();
  private isHost: boolean;
  private roomId: string;
  private hostId: string;
  
  // Excalidraw expects socket.connected
  public connected: boolean = false;

  constructor(roomId: string, isHost: boolean) {
    this.roomId = roomId;
    this.isHost = isHost;
    this.hostId = `excalidraw-data-${roomId}-host`;
    // Generate a random client ID. The host needs a unique socket ID too for Excalidraw's internal logic.
    this.id = isHost ? "host" : `client-${Math.random().toString(36).substr(2, 9)}`;

    setTimeout(() => {
      this.initPeer();
    }, 0);
  }

  private initPeer() {
    const peerId = this.isHost ? this.hostId : `excalidraw-data-${this.roomId}-${this.id}`;
    this.peer = new Peer(peerId, { debug: 1 });

    this.peer.on("open", (id) => {
      this.connected = true;
      this.emitLocal("connect");

      if (this.isHost) {
        // Host waits for connections
        this.emitLocal("init-room");
      } else {
        // Client connects to host
        const conn = this.peer!.connect(this.hostId, { reliable: true });
        this.setupConnection(conn);
      }
    });

    if (this.isHost) {
      this.peer.on("connection", (conn) => {
        this.setupConnection(conn);
      });
    }

    this.peer.on("error", (err) => {
      console.error("PeerJSSocket Error:", err);
      this.emitLocal("connect_error", err);
    });
  }

  private setupConnection(conn: DataConnection) {
    conn.on("open", () => {
      this.connections.set(conn.peer, conn);

      if (this.isHost) {
        // Host logic: New user joined
        // Determine the socket ID of the remote user (extract from peer ID)
        const remoteSocketId = conn.peer.replace(`excalidraw-data-${this.roomId}-`, "");
        
        // Broadcast new user to everyone (including self)
        this.broadcastRoomUserChange();
        
        // Tell local excalidraw instance to broadcast scene to the new user
        this.emitLocal("new-user", remoteSocketId);
      } else {
        // Client logic: connected to host
        this.emitLocal("init-room");
      }
    });

    conn.on("data", (data: any) => {
      if (data && data.event) {
        if (this.isHost && data.event === "client-broadcast") {
          // Relay broadcast to other clients
          this.connections.forEach((c) => {
            if (c.peer !== conn.peer) {
              c.send(data);
            }
          });
          // Also process locally
          this.emitLocal(data.event, data.payload);
        } else {
          this.emitLocal(data.event, data.payload);
        }
      }
    });

    conn.on("close", () => {
      this.connections.delete(conn.peer);
      if (this.isHost) {
        this.broadcastRoomUserChange();
      }
    });
    
    conn.on("error", (err) => {
      console.error("Connection error:", err);
      this.connections.delete(conn.peer);
    });
  }

  private broadcastRoomUserChange() {
    // Collect all socket IDs (host + clients)
    const clients = [this.id];
    for (const peerId of this.connections.keys()) {
      const socketId = peerId.replace(`excalidraw-data-${this.roomId}-`, "");
      clients.push(socketId);
    }
    
    const data = { event: "room-user-change", payload: clients };
    // Send to all remote clients
    this.connections.forEach(conn => conn.send(data));
    // Trigger locally
    this.emitLocal("room-user-change", clients);
  }

  public emit(event: string, ...args: any[]) {
    if (event === "join-room") {
      // Handled locally
      if (this.isHost) {
        this.broadcastRoomUserChange();
      }
      return;
    }

    if (event === "client-broadcast") {
      const payload = args[0];
      const data = { event: "client-broadcast", payload };
      
      if (this.isHost) {
        // Host broadcasts to all clients
        this.connections.forEach(conn => conn.send(data));
      } else {
        // Client sends to host
        const hostConn = this.connections.get(this.hostId);
        if (hostConn) hostConn.send(data);
      }
    }
  }

  public on(event: string, handler: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  public once(event: string, handler: Function) {
    const wrapped = (...args: any[]) => {
      handler(...args);
      this.off(event, wrapped);
    };
    this.on(event, wrapped);
  }

  public off(event: string, handler?: Function) {
    if (!handler) {
      this.listeners.delete(event);
    } else {
      const handlers = this.listeners.get(event);
      if (handlers) {
        this.listeners.set(event, handlers.filter(h => h !== handler));
      }
    }
  }

  private emitLocal(event: string, ...args: any[]) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(h => h(...args));
    }
  }

  public close() {
    this.connected = false;
    this.connections.forEach(conn => conn.close());
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
