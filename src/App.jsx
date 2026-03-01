import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { io } from 'socket.io-client';
import './index.css';

// --- GLSL SHADERS ---
const vertexShader = `
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  
  uniform float uTime;
  uniform float uDistortion;

  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  
  float cnoise(vec3 v){ 
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i); 
    vec4 p = permute( permute( permute( 
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }

  void main() {
    vUv = uv;
    vNormal = normal;
    
    // Slower, more ominous movement
    float noise = cnoise(position * 2.0 + uTime * 0.1);
    
    // Sharp spikes during glitch
    vec3 displacedPosition = position + normal * noise * uDistortion;
    
    vPosition = displacedPosition;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  
  uniform float uTime;
  uniform vec3 uColorNeon;
  uniform vec3 uColorSand;
  uniform float uGlitchIntensity;

  void main() {
    float sandGrit = fract(sin(dot(vUv.xy ,vec2(12.9898,78.233))) * 43758.5453) * 0.15;
    
    // Fractal-like cracks
    float crackPattern = sin(vPosition.x * 12.0 + uTime) * sin(vPosition.y * 12.0) * sin(vPosition.z * 12.0);
    float glowThreshold = smoothstep(0.8 - uGlitchIntensity*0.5, 1.0, crackPattern);
    
    vec3 finalColor = mix(uColorSand + sandGrit, uColorNeon, glowThreshold);
    
    float rim = 1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
    rim = smoothstep(0.6, 1.0, rim);
    finalColor += uColorNeon * rim * (0.2 + uGlitchIntensity);

    // Random scanline effect inside the material
    float scanline = sin(vPosition.y * 100.0 - uTime * 20.0) * 0.05 * uGlitchIntensity;
    finalColor += scanline;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// --- WEB AUDIO API DRONE ---
class AudioController {
  constructor() {
    this.ctx = null;
    this.osc1 = null;
    this.osc2 = null;
    this.gain = null;
    this.initialized = false;
  }
  
  init() {
    if (this.initialized) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    this.osc1 = this.ctx.createOscillator();
    this.osc2 = this.ctx.createOscillator();
    this.gain = this.ctx.createGain();
    
    this.osc1.type = 'sine';
    this.osc1.frequency.setValueAtTime(43.65, this.ctx.currentTime);
    
    this.osc2.type = 'sawtooth';
    this.osc2.frequency.setValueAtTime(44.0, this.ctx.currentTime);
    
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    
    this.osc1.connect(this.gain);
    this.osc2.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    
    this.osc1.start();
    this.osc2.start();
    this.initialized = true;
  }

  play() {
    if(!this.initialized) this.init();
    if(this.ctx.state === 'suspended') this.ctx.resume();
    this.gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 2);
  }

  triggerGlitch() {
    if(!this.initialized) return;
    this.osc2.frequency.setValueAtTime(150, this.ctx.currentTime);
    this.osc2.frequency.exponentialRampToValueAtTime(44.0, this.ctx.currentTime + 0.5);
    this.gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    this.gain.gain.exponentialRampToValueAtTime(0.15, this.ctx.currentTime + 0.5);
  }
}

const audioCtrl = new AudioController();

// --- 3D ARTIFACT ---
const SignalArtifact = ({ isGlitching, onInteract }) => {
  const meshRef = useRef();
  const groupRef = useRef();
  
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uDistortion: { value: 0.1 },
    uGlitchIntensity: { value: 0.0 },
    uColorNeon: { value: new THREE.Color('#FF4500') }, 
    uColorSand: { value: new THREE.Color('#050505') }  
  }), []);

  useFrame((state) => {
    const { clock } = state;
    if (meshRef.current) {
      meshRef.current.material.uniforms.uTime.value = clock.getElapsedTime();
      
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.1;
      groupRef.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.2) * 0.2;
      
      if (isGlitching) {
        meshRef.current.material.uniforms.uDistortion.value = 0.5 + Math.random() * 0.8;
        meshRef.current.material.uniforms.uGlitchIntensity.value = 1.0;
        groupRef.current.position.x = (Math.random() - 0.5) * 0.1;
      } else {
        meshRef.current.material.uniforms.uDistortion.value = THREE.MathUtils.lerp(
          meshRef.current.material.uniforms.uDistortion.value, 
          0.1, 
          0.05
        );
        meshRef.current.material.uniforms.uGlitchIntensity.value = THREE.MathUtils.lerp(
          meshRef.current.material.uniforms.uGlitchIntensity.value, 
          0.0, 
          0.1
        );
        groupRef.current.position.x = 0;
      }
    }
  });

  return (
    <group ref={groupRef}>
      <mesh onClick={onInteract} visible={false}>
        <sphereGeometry args={[2.5, 16, 16]} />
        <meshBasicMaterial />
      </mesh>
      
      <mesh ref={meshRef} scale={[1, 1.8, 1]}>
        <octahedronGeometry args={[1, 4]} />
        <shaderMaterial 
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          wireframe={false}
        />
      </mesh>
      
      <mesh rotation={[Math.PI/2, 0, 0]} scale={2}>
        <torusGeometry args={[1, 0.01, 16, 100]} />
        <meshBasicMaterial color={isGlitching ? "#FF4500" : "#333"} transparent opacity={isGlitching ? 0.8 : 0.2} />
      </mesh>
    </group>
  );
};

export default function App() {
  const [timeLeft, setTimeLeft] = useState(3600);
  const [isGlitching, setIsGlitching] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const [crypticText, setCrypticText] = useState("AWAITING SIGNAL");
  const [started, setStarted] = useState(false);
  const [population, setPopulation] = useState(1);
  const [shadows, setShadows] = useState({});
  const socketRef = useRef(null);

  useEffect(() => {
    // Connect to Presence Server via localtunnel URL
    socketRef.current = io("https://sweet-bushes-tease.loca.lt", {
      transports: ["websocket", "polling"],
    });

    socketRef.current.on('population', (count) => {
      setPopulation(count);
    });

    socketRef.current.on('shadow_move', (data) => {
      setShadows(prev => ({
        ...prev,
        [data.id]: { x: data.x, y: data.y, active: true }
      }));
    });

    socketRef.current.on('shadow_leave', (id) => {
      setShadows(prev => {
        const newShadows = { ...prev };
        delete newShadows[id];
        return newShadows;
      });
    });

    socketRef.current.on('shadow_spark', (data) => {
      // Could render a flash here
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  // Track and emit our cursor movement
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!started || !socketRef.current) return;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      
      // Throttle emits slightly by only sending 1 in N updates or on interval
      if (Math.random() > 0.5) {
        socketRef.current.emit('move', { x, y });
      }
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [started]);

  useEffect(() => {
    const handleFirstClick = (e) => {
      if(!started) {
        audioCtrl.play();
        setStarted(true);
      }
      
      if (started && socketRef.current) {
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        socketRef.current.emit('spark', { x, y });
      }
    };
    window.addEventListener('click', handleFirstClick);
    return () => window.removeEventListener('click', handleFirstClick);
  }, [started]);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const glitchInterval = setInterval(() => {
      if (Math.random() > 0.8) {
        setIsGlitching(true);
        if(started) audioCtrl.triggerGlitch();
        
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
        let scrambled = "";
        for(let i=0; i<15; i++) scrambled += chars.charAt(Math.floor(Math.random() * chars.length));
        setCrypticText(scrambled);

        setTimeout(() => {
          setIsGlitching(false);
          setCrypticText("AWAITING SIGNAL");
        }, 150 + Math.random() * 400);
      }
    }, 4000);
    return () => clearInterval(glitchInterval);
  }, [started]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const handleArtifactInteract = (e) => {
    e.stopPropagation();
    if (isGlitching && !accessGranted) {
      setAccessGranted(true);
      if(started) {
        audioCtrl.osc1.frequency.linearRampToValueAtTime(200, audioCtrl.ctx.currentTime + 1);
      }
    }
  };

  return (
    <div className="container">
      {!started && (
        <div className="start-overlay">
          <p>CLICK TO INITIALIZE FREQUENCY</p>
        </div>
      )}

      {/* Render Shadows */}
      {Object.entries(shadows).map(([id, pos]) => (
        <div 
          key={id} 
          className="shadow-cursor"
          style={{
            left: pos.x * window.innerWidth,
            top: pos.y * window.innerHeight,
          }}
        />
      ))}

      <Canvas camera={{ position: [0, 0, 6] }} style={{ position: 'absolute', top: 0, left: 0, zIndex: 0 }}>
        <ambientLight intensity={0.2} />
        <SignalArtifact isGlitching={isGlitching} onInteract={handleArtifactInteract} />
      </Canvas>

      <div className="overlay" style={{ pointerEvents: 'none' }}>
        <div className="top-ui">
          <span className="cryptic">{crypticText}</span>
          <span className="coords">CONNECTIONS: {population}</span>
        </div>
        
        {!accessGranted && (
          <div className={`timer-container ${isGlitching ? 'timer-glitch' : ''}`}>
            <div className="timer-label">EST. MATERIALIZATION</div>
            <div className="timer">{formatTime(timeLeft)}</div>
          </div>
        )}

        {accessGranted && (
          <div className="granted-box">
            <h2 className="glitch-text-permanent">SIGNAL INTERCEPTED</h2>
            <p>THE ARK AWAITS.</p>
            <div className="terminal-line">&gt; Generating SBT Visa...</div>
            <button className="visa-btn" style={{ pointerEvents: 'auto' }}>CONNECT TO BOT</button>
          </div>
        )}
      </div>
      
      <div className="vhs-overlay"></div>
      <div className="scanlines"></div>
      {isGlitching && <div className="chromatic-aberration"></div>}
    </div>
  );
}
