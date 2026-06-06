import React, { useEffect, useState, useRef } from "react";
import { webRTCManager, PeerStream } from "../collab/WebRTCManager";
import { useAtom } from "jotai";
import { isCollaboratingAtom } from "../collab/Collab";

import "./VideoCallGallery.css"; 

const VideoPlayer = ({ stream, isLocal }: { stream: MediaStream; isLocal?: boolean }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const hasVideo = stream.getVideoTracks().some(track => track.enabled || track.readyState === 'live');
  const hasAudio = stream.getAudioTracks().some(track => track.enabled || track.readyState === 'live');

  useEffect(() => {
    if (videoRef.current && stream && hasVideo) {
      videoRef.current.srcObject = stream;
      if (isLocal) {
        videoRef.current.muted = true;
      }
    }
    if (audioRef.current && stream && !hasVideo && hasAudio) {
      audioRef.current.srcObject = stream;
      if (isLocal) {
        audioRef.current.muted = true;
      }
    }
  }, [stream, isLocal, hasVideo, hasAudio]);

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    if (!document.fullscreenElement) {
      videoRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // If there are no tracks, or all tracks are stopped/disabled, don't render anything
  if (!hasVideo && !hasAudio) {
    return null;
  }

  if (!hasVideo && hasAudio) {
    return (
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        muted={isLocal}
        style={{ display: "none" }}
      />
    );
  }

  return (
    <div className="video-container">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={isLocal && stream.getVideoTracks()[0]?.label.includes("screen") ? "" : "mirrored"}
      />
      <button className="video-fullscreen-btn" onClick={toggleFullscreen} title="Fullscreen">
        ⛶
      </button>
    </div>
  );
};

export const VideoCallGallery = () => {
  const [streams, setStreams] = useState<PeerStream[]>([]);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isAudioOn, setIsAudioOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCollaborating] = useAtom(isCollaboratingAtom);

  const [position, setPosition] = useState({ x: 20, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!isCollaborating) {
      setStreams([]);
      setIsVideoOn(false);
      setIsAudioOn(false);
      setIsScreenSharing(false);
      return;
    }

    webRTCManager.subscribe((newStreams) => {
      setStreams(newStreams);
    });

    return () => {
      webRTCManager.subscribe(() => {});
    };
  }, [isCollaborating]);

  const toggleVideo = () => {
    const nextState = !isVideoOn;
    webRTCManager.toggleVideoAudio(nextState, isAudioOn);
    setIsVideoOn(nextState);
  };

  const toggleAudio = () => {
    const nextState = !isAudioOn;
    webRTCManager.toggleVideoAudio(isVideoOn, nextState);
    setIsAudioOn(nextState);
  };

  const toggleScreen = () => {
    const nextState = !isScreenSharing;
    webRTCManager.toggleScreenShare(nextState);
    setIsScreenSharing(nextState);
  };

  if (!isCollaborating) return null;

  const handlePointerDown = (e: React.PointerEvent) => {
    // Don't drag if clicking buttons, or the resize handle
    if ((e.target as HTMLElement).tagName.toLowerCase() === 'button') return;
    if ((e.target as HTMLElement).classList.contains('webrtc-videos')) return; // Allow resizing
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const visibleVideosCount = streams.filter(s => s.stream.getVideoTracks().length > 0).length;

  return (
    <div 
      className={`webrtc-gallery-wrapper ${isDragging ? 'dragging' : ''} ${isMinimized ? 'minimized' : ''} ${visibleVideosCount === 0 ? 'no-videos' : ''}`}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="gallery-header">
        <span className="drag-handle">Video Call {visibleVideosCount > 0 ? `(${visibleVideosCount})` : ''}</span>
        <button className="minimize-btn" onClick={() => setIsMinimized(!isMinimized)} title={isMinimized ? "Expand" : "Minimize"}>
          {isMinimized ? "↗" : "↙"}
        </button>
      </div>

      {!isMinimized && (
        <div className="webrtc-videos">
          {streams.map(s => (
            <VideoPlayer key={s.peerId} stream={s.stream} isLocal={s.peerId === 'local' || s.peerId === 'local-screen'} />
          ))}
        </div>
      )}

      <div className="webrtc-controls">
        <button onClick={toggleVideo} className={isVideoOn ? "active" : ""}>
          {isVideoOn ? "Stop Video" : "Start Video"}
        </button>
        <button onClick={toggleAudio} className={isAudioOn ? "active" : ""}>
          {isAudioOn ? "Mute" : "Unmute"}
        </button>
        <button onClick={toggleScreen} className={isScreenSharing ? "active" : ""}>
          {isScreenSharing ? "Stop Share" : "Share Screen"}
        </button>
      </div>
    </div>
  );
};
