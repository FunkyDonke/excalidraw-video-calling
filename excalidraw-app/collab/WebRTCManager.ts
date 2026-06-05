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
    if (video || audio) {
      if (!this.localStream) {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ video, audio });
        } catch (e) {
          console.error("Failed to get media devices", e);
          return;
        }
      } else {
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) videoTrack.enabled = video;
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) audioTrack.enabled = audio;
      }
      this.isVideoEnabled = video;
      this.isAudioEnabled = audio;
      
      // Send stream to existing connections
      this.replaceStreamInConnections(this.localStream);
      
      // Fire local stream added event
      this.updateStreams(prev => {
        const filtered = prev.filter(s => s.peerId !== 'local');
        return [...filtered, { peerId: 'local', stream: this.localStream! }];
      });
    } else {
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }
      this.isVideoEnabled = false;
      this.isAudioEnabled = false;
      this.updateStreams(prev => prev.filter(s => s.peerId !== 'local'));
    }
  }

  public async toggleScreenShare(enable: boolean) {
    if (enable) {
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        this.isScreenSharing = true;
        
        this.screenStream.getVideoTracks()[0].onended = () => {
          this.toggleScreenShare(false);
        };
        
        this.replaceStreamInConnections(this.screenStream);
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
      if (this.localStream) {
        this.replaceStreamInConnections(this.localStream);
      }
    }
  }

  private replaceStreamInConnections(stream: MediaStream) {
    this.connections.forEach(call => {
      // PeerJS doesn't easily support replacing tracks dynamically without renegotiation in older versions,
      // but if the call is active, we can try to replace the sender's track.
      // Alternatively, we just re-call them.
      call.peerConnection?.getSenders().forEach(sender => {
        if (sender.track?.kind === 'video') {
          sender.replaceTrack(stream.getVideoTracks()[0]);
        }
        if (sender.track?.kind === 'audio') {
          sender.replaceTrack(stream.getAudioTracks()[0]);
        }
      });
    });
  }

  public connectToPeer(socketId: string) {
    if (!this.peer || !this.currentRoomId) return;
    const peerId = this.generatePeerId(socketId);
    
    if (this.connections.has(peerId) || peerId === this.peer.id) return;

    // Only call if we have a stream, or call empty just to connect (PeerJS allows data only but we are doing media)
    const call = this.peer.call(peerId, this.screenStream || this.localStream || new MediaStream());
    
    if (!call) return; // Happens if peer is destroyed

    this.connections.set(peerId, call);

    call.on('stream', (remoteStream) => {
      this.updateStreams(prev => {
        if (prev.find(s => s.peerId === peerId)) return prev;
        return [...prev, { peerId, stream: remoteStream }];
      });
    });

    call.on('close', () => {
      this.updateStreams(prev => prev.filter(s => s.peerId !== peerId));
      this.connections.delete(peerId);
    });
    
    call.on('error', (err) => {
      console.error("Call error", err);
      this.connections.delete(peerId);
    });
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
