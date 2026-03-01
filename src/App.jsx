import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import './index.css';

// --- GLSL SHADERS ---
const vertexShader = `
  varying vec2 vUv;
  varying vec3 vPosition;
  varying vec3 vNormal;
  
  uniform float uTime;
  uniform float uDistortion;

  // Classic Perlin 3D Noise by Stefan Gustavson
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
    
    float noise = cnoise(position * 1.5 + uTime * 0.4);
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

  void main() {
    float sandGrit = fract(sin(dot(vUv.xy ,vec2(12.9898,78.233))) * 43758.5453) * 0.15;
    
    float crackPattern = sin(vPosition.x * 8.0 + uTime) * sin(vPosition.y * 8.0) * sin(vPosition.z * 8.0);
    float glowThreshold = smoothstep(0.7, 1.0, crackPattern);
    
    vec3 finalColor = mix(uColorSand + sandGrit, uColorNeon, glowThreshold);
    
    float rim = 1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
    rim = smoothstep(0.5, 1.0, rim);
    finalColor += uColorNeon * rim * 0.6;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

const SignalArtifact = ({ isGlitching }) => {
  const meshRef = useRef();
  
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uDistortion: { value: 0.2 },
    uColorNeon: { value: new THREE.Color('#FF4500') }, 
    uColorSand: { value: new THREE.Color('#111111') }  
  }), []);

  useFrame((state) => {
    const { clock } = state;
    if (meshRef.current) {
      meshRef.current.material.uniforms.uTime.value = clock.getElapsedTime();
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.15;
      meshRef.current.rotation.z = clock.getElapsedTime() * 0.05;
      
      if (isGlitching || Math.random() > 0.98) {
        meshRef.current.material.uniforms.uDistortion.value = 0.4 + Math.random() * 0.5;
      } else {
        meshRef.current.material.uniforms.uDistortion.value = THREE.MathUtils.lerp(
          meshRef.current.material.uniforms.uDistortion.value, 
          0.2, 
          0.1
        );
      }
    }
  });

  return (
    <mesh ref={meshRef} scale={1.5}>
      <icosahedronGeometry args={[1, 64]} />
      <shaderMaterial 
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        wireframe={false}
      />
    </mesh>
  );
};

export default function App() {
  const [timeLeft, setTimeLeft] = useState(3600); // 1 hour
  const [isGlitching, setIsGlitching] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const glitchInterval = setInterval(() => {
      if (Math.random() > 0.7) {
        setIsGlitching(true);
        setTimeout(() => setIsGlitching(false), 200 + Math.random() * 500);
      }
    }, 3000);
    return () => clearInterval(glitchInterval);
  }, []);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return \`\${h}:\${m}:\${s}\`;
  };

  const handleSecretClick = () => {
    if (isGlitching) {
      setAccessGranted(true);
    }
  };

  return (
    <div className="container" onClick={handleSecretClick}>
      <Canvas camera={{ position: [0, 0, 5] }} style={{ position: 'absolute', top: 0, left: 0, zIndex: 0 }}>
        <ambientLight intensity={0.5} />
        <SignalArtifact isGlitching={isGlitching} />
      </Canvas>

      <div className="overlay" style={{ pointerEvents: 'none' }}>
        <h1 className={isGlitching ? 'glitch-text' : ''}>
          {accessGranted ? "ARCHITECT CONSOLE ACCESSED" : "SIGNAL IN"}
        </h1>
        
        {!accessGranted && (
          <div className={\`timer \${isGlitching ? 'timer-glitch' : ''}\`}>
            {formatTime(timeLeft)}
          </div>
        )}

        {accessGranted && (
          <div className="granted-box">
            <p>YOU FOUND THE LOST SIGNAL</p>
            <button className="visa-btn" style={{ pointerEvents: 'auto' }}>OBTAIN SBT VISA</button>
          </div>
        )}
      </div>
      
      {/* VCR scanline effect */}
      <div className="scanlines"></div>
    </div>
  );
}
