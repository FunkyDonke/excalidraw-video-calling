import React, { useEffect, useState, useRef } from "react";
import { webRTCManager, PeerStream } from "../collab/WebRTCManager";
import { useAtom } from "jotai";
import { isCollaboratingAtom } from "../collab/Collab";

import "./VideoCallGallery.css"; 

const VideoPlayer = ({ stream, isLocal }: { stream: MediaStream; isLocal?: boolean }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="video-container">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={isLocal && stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].label.includes("screen") ? "" : "mirrored"}
      />
    </div>
  );
};

export const VideoCallGallery = () => {
  const [streams, setStreams] = useState<PeerStream[]>([]);
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [isAudioOn, setIsAudioOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isCollaborating] = useAtom(isCollaboratingAtom);

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
      // Unsubscribe by overwriting or ignoring (WebRTCManager only supports one subscriber right now which is fine)
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

  return (
    <div className="webrtc-gallery-wrapper">
      <div className="webrtc-videos">
        {streams.map(s => (
          <VideoPlayer key={s.peerId} stream={s.stream} isLocal={s.peerId === 'local' || s.peerId === 'local-screen'} />
        ))}
      </div>
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
