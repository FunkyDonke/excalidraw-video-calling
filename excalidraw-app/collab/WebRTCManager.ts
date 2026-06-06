import Peer, { MediaConnection } from "peerjs";

export type PeerStream = {
  peerId: string;
  stream: MediaStream;
};

type WebRTCListeners = {
  onStreamAdded: (stream: PeerStream) => void;
  onStreamRemoved: (peerId: string) => void;
};

class WebRTCManager {
  private peer: Peer | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private connections: Map<string, MediaConnection> = new Map();
  private streams: PeerStream[] = [];
  private onStreamsChanged: ((streams: PeerStream[]) => void) | null = null;
  private currentRoomId: string | null = null;
  private currentSocketId: string | null = null;
  
  public isVideoEnabled = false;
  public isAudioEnabled = false;
  public isScreenSharing = false;

  public subscribe(callback: (streams: PeerStream[]) => void) {
    this.onStreamsChanged = callback;
    callback(this.streams);
  }

  private updateStreams(updateFn: (prev: PeerStream[]) => PeerStream[]) {
    this.streams = updateFn(this.streams);
    this.onStreamsChanged?.(this.streams);
  }

  public init(roomId: string, socketId: string) {
    if (this.peer) {
      this.peer.destroy();
    }
    
    this.currentRoomId = roomId;
    this.currentSocketId = socketId;
    
    const myPeerId = this.generatePeerId(socketId);
    
    this.peer = new Peer(myPeerId, {
      debug: 2
    });

    this.peer.on('open', (id) => {
      console.log('PeerJS connected with ID:', id);
    });

    this.peer.on('call', (call) => {
      // Answer incoming calls with our local stream if available
      call.answer(this.localStream || undefined);
      
      this.connections.set(call.peer, call);
      
      call.on('stream', (remoteStream) => {
        this.updateStreams(prev => {
          if (prev.find(s => s.peerId === call.peer)) return prev;
          return [...prev, { peerId: call.peer, stream: remoteStream }];
        });
      });

      call.on('close', () => {
        this.updateStreams(prev => prev.filter(s => s.peerId !== call.peer));
        this.connections.delete(call.peer);
      });
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS error:', err);
    });
  }

  public generatePeerId(socketId: string) {
    return `excalidraw-${this.currentRoomId}-${socketId}`;
  }

  public async toggleVideoAudio(video: boolean, audio: boolean) {
    // If no media is requested, stop everything
    if (!video && !audio) {
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }
      this.isVideoEnabled = false;
      this.isAudioEnabled = false;
      this.updateStreams(prev => prev.filter(s => s.peerId !== 'local'));
      this.replaceStreamInConnections();
      return;
    }

    // Stop existing tracks to fully re-negotiate and turn off hardware lights
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ 
        video, 
        audio: audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false 
      });
    } catch (e) {
      console.error("Failed to get media devices", e);
      return;
    }

    this.isVideoEnabled = video;
    this.isAudioEnabled = audio;
    
    // Fire local stream added event
    this.updateStreams(prev => {
      const filtered = prev.filter(s => s.peerId !== 'local');
      return [...filtered, { peerId: 'local', stream: this.localStream! }];
    });

    // Send stream to existing connections
    this.replaceStreamInConnections();
  }

  public async toggleScreenShare(enable: boolean) {
    if (enable) {
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        this.isScreenSharing = true;
        
        this.screenStream.getVideoTracks()[0].onended = () => {
          this.toggleScreenShare(false);
        };
        
        this.replaceStreamInConnections();
        this.updateStreams(prev => {
          const filtered = prev.filter(s => s.peerId !== 'local-screen');
          return [...filtered, { peerId: 'local-screen', stream: this.screenStream! }];
        });
      } catch (e) {
        console.error("Failed to share screen", e);
      }
    } else {
      if (this.screenStream) {
        this.screenStream.getTracks().forEach(track => track.stop());
        this.screenStream = null;
      }
      this.isScreenSharing = false;
      this.updateStreams(prev => prev.filter(s => s.peerId !== 'local-screen'));
      // Revert back to local camera stream if enabled
      this.replaceStreamInConnections();
    }
  }

  private replaceStreamInConnections() {
    // WebRTC replaceTrack silently fails if transceivers weren't originally negotiated.
    // The most robust way to add/change video in PeerJS is to re-call the peers with the new stream.
    const peerIds = Array.from(this.connections.keys());
    peerIds.forEach(peerId => {
      // Close the old call
      const oldCall = this.connections.get(peerId);
      if (oldCall) oldCall.close();
      this.connections.delete(peerId);
      
      // Remove old streams from this peer
      this.updateStreams(prev => prev.filter(s => s.peerId !== peerId));

      // Re-call with the new stream
      const streamToSend = this.isScreenSharing ? this.screenStream : this.localStream;
      const call = this.peer!.call(peerId, streamToSend || new MediaStream());
      this.setupCall(call);
    });
  }

  private setupCall(call: MediaConnection) {
    this.connections.set(call.peer, call);
    
    call.on('stream', (remoteStream) => {
      this.updateStreams(prev => {
        if (prev.find(s => s.peerId === call.peer)) return prev;
        return [...prev, { peerId: call.peer, stream: remoteStream }];
      });
    });

    call.on('close', () => {
      this.updateStreams(prev => prev.filter(s => s.peerId !== call.peer));
      this.connections.delete(call.peer);
    });

    call.on('error', (err) => {
      console.error("Call error", err);
      this.connections.delete(call.peer);
    });
  }

  public connectToPeer(socketId: string) {
    if (!this.peer) return;
    const peerId = this.generatePeerId(socketId);
    if (this.connections.has(peerId)) return;

    const streamToSend = this.isScreenSharing ? this.screenStream : this.localStream;
    const call = this.peer.call(peerId, streamToSend || new MediaStream());
    
    this.setupCall(call);
  }

  public disconnectFromPeer(socketId: string) {
    const peerId = this.generatePeerId(socketId);
    const call = this.connections.get(peerId);
    if (call) {
      call.close();
      this.connections.delete(peerId);
    }
    this.updateStreams(prev => prev.filter(s => s.peerId !== peerId));
  }

  public destroy() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
    }
    this.connections.forEach(call => call.close());
    this.connections.clear();
    
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}

export const webRTCManager = new WebRTCManager();
