/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type ReactNode, useCallback, type MouseEvent, type ChangeEvent, type TouchEvent, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, Bird, Flame, Trophy, Pen, X, Eraser, Check, Volume2, VolumeX, Undo2 } from 'lucide-react';
import chirpSound from './assets/chirp.mp3';
import defaultBg from './assets/2.jpg';
import { io, Socket } from 'socket.io-client';

interface BirdInstance {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  rotation: number;
  scale: number;
  flapSpeed: number;
  isGliding: boolean;
  glideTimer: number;
  history: { x: number; y: number; rotation: number }[];
  customImage?: string;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number; // 0 to 1
  decay: number;
}

// Fluorescent Cyan bird colors (荧光青色系)
const BIRD_COLORS = [
  'text-[#00FFFF]', // Electric Cyan
  'text-[#00F5FF]', // Neon Cyan
  'text-[#00E5EE]', // Bright Cyan
  'text-[#7FFFD4]', // Aquamarine Neon
  'text-[#00FFD1]', // Cyan Greenish
  'text-[#5FFFFF]'  // Light Neon Cyan
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const birdsRef = useRef<BirdInstance[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const [regions, setRegions] = useState<{id: number, x1: number, y1: number, x2: number, y2: number}[]>([]);

  useEffect(() => {
    setRegions([
      { id: 1, x1: window.innerWidth * 0.7, y1: window.innerHeight * 0.2, x2: window.innerWidth * 0.9, y2: window.innerHeight * 0.8 }
    ]);
  }, []);
  const [totalSpawned, setTotalSpawned] = useState(0);
  const [showAchievement, setShowAchievement] = useState(false);
  const [achievementName, setAchievementName] = useState("");
  const [earnedAchievements, setEarnedAchievements] = useState<string[]>([]);
  const [backgroundImage, setBackgroundImage] = useState<string>(defaultBg);
  const [customBirdImage, setCustomBirdImage] = useState<string | null>(null);
  const [drawingHistory, setDrawingHistory] = useState<string[]>([]);
  const [isDrawingOpen, setIsDrawingOpen] = useState(false);
  const [clickCount, setClickCount] = useState(0);
  const [showFileLostModal, setShowFileLostModal] = useState(false);
  const [isCorrupted, setIsCorrupted] = useState(false);
  const [corruptedClickCount, setCorruptedClickCount] = useState(0);
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const audioPlayPromiseRef = useRef<Promise<void> | null>(null);
  const flapPlayPromiseRef = useRef<Promise<void> | null>(null);
  const chirpAudioRef1 = useRef<HTMLAudioElement | null>(null);
  const chirpAudioRef2 = useRef<HTMLAudioElement | null>(null);
  const flapAudioRef = useRef<HTMLAudioElement | null>(null);
  const isCorruptedRef = useRef(false);
  const corruptedCanvasesRef = useRef<Record<string, HTMLCanvasElement>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const offsetXRef = useRef(0);

  const openDrawing = (e: MouseEvent) => {
    e.stopPropagation();
    setIsDrawingOpen(true);
  };

  const toggleSound = async () => {
    if (isSoundEnabled) {
      if (flapAudioRef.current) {
        if (flapPlayPromiseRef.current) {
          await flapPlayPromiseRef.current.catch(() => {});
        }
        flapAudioRef.current.pause();
        flapPlayPromiseRef.current = null;
      }
    } else {
      if (flapAudioRef.current) {
        flapAudioRef.current.volume = 0.2;
        flapPlayPromiseRef.current = flapAudioRef.current.play();
        flapPlayPromiseRef.current.then(() => {
          flapPlayPromiseRef.current = null;
        }).catch(() => {
          flapPlayPromiseRef.current = null;
        });
      }
    }
    setIsSoundEnabled(!isSoundEnabled);
  };

  const playChirp = useCallback(() => {
    if (!isSoundEnabled) return;
    const refs = [chirpAudioRef1, chirpAudioRef2];
    const availableRef = refs.find(ref => ref.current && (ref.current.paused || ref.current.ended));
    if (availableRef && availableRef.current) {
      const chirp = availableRef.current;
      chirp.currentTime = 0;
      chirp.volume = 0.15 + Math.random() * 0.3;
      chirp.playbackRate = 0.7 + Math.random() * 0.9;
      chirp.play().catch(() => {});
    }
  }, [isSoundEnabled]);

  // Socket connection
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', { width: window.innerWidth, height: window.innerHeight });
    });

    socket.on('layout_update', (data) => {
      const client = data.clients.find((c: any) => c.id === socket.id);
      if (client) {
        offsetXRef.current = client.offsetX;
      }
    });

    socket.on('init', (data) => {
      birdsRef.current = data.birds.map((b: any) => ({ ...b, history: [] }));
    });

    socket.on('state_update', (data) => {
      const prevBirds = birdsRef.current;
      birdsRef.current = data.birds.map((serverBird: any) => {
        const prevBird = prevBirds.find(b => b.id === serverBird.id);
        const history = prevBird ? [
          { x: prevBird.x, y: prevBird.y, rotation: prevBird.rotation },
          ...prevBird.history
        ].slice(0, 5) : [];
        return { ...serverBird, history };
      });
    });

    socket.on('birds_cleared', () => {
      birdsRef.current = [];
    });

    const handleResize = () => {
      socket.emit('resize', { width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.disconnect();
    };
  }, []);

  // Render Loop
  useEffect(() => {
    let animationFrameId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const updatePositions = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      const prevBirds = birdsRef.current;
      
      if (flapAudioRef.current && isSoundEnabled) {
        const targetVolume = Math.min(0.3, Math.min(prevBirds.length, 2) * 0.15);
        flapAudioRef.current.volume = flapAudioRef.current.volume * 0.9 + targetVolume * 0.1;
        
        if (prevBirds.length === 0 && flapAudioRef.current.volume < 0.01 && !flapAudioRef.current.paused) {
          if (!flapPlayPromiseRef.current) {
            flapAudioRef.current.pause();
          } else {
            flapPlayPromiseRef.current.then(() => {
              if (flapAudioRef.current && prevBirds.length === 0) {
                flapAudioRef.current.pause();
              }
              flapPlayPromiseRef.current = null;
            }).catch(() => {
              flapPlayPromiseRef.current = null;
            });
          }
        } else if (prevBirds.length > 0 && flapAudioRef.current.paused && !flapPlayPromiseRef.current) {
          flapPlayPromiseRef.current = flapAudioRef.current.play();
          flapPlayPromiseRef.current.then(() => {
            flapPlayPromiseRef.current = null;
          }).catch(() => {
            flapPlayPromiseRef.current = null;
          });
        }
      }

      // Update Particles
      particlesRef.current = particlesRef.current
        .map(p => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          life: p.life - p.decay
        }))
        .filter(p => p.life > 0);

      // Spawn new particles for each bird
      birdsRef.current.forEach(bird => {
        const localX = bird.x - offsetXRef.current;
        const localY = bird.y;

        // Only spawn particles if bird is somewhat visible
        if (localX < -100 || localX > canvas.width + 100) return;

        if (!bird.customImage && (!bird.isGliding || Math.random() > 0.7)) {
          const color = bird.color.startsWith('text-[') ? bird.color.replace('text-[', '').replace(']', '') : '#00FFFF';
          const tailX = localX - Math.cos(bird.rotation) * (30 * bird.scale);
          const tailY = localY - Math.sin(bird.rotation) * (30 * bird.scale);
          
          const spawnParticle = (px: number, py: number, pSize: number) => {
            if (particlesRef.current.length < 800) {
              particlesRef.current.push({
                id: Math.random(),
                x: px,
                y: py,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                size: pSize,
                color,
                life: 1.0,
                decay: 0.02 + Math.random() * 0.03
              });
            }
          };

          spawnParticle(tailX, tailY, 1 + Math.random() * 2 * bird.scale);

          for (let i = 0; i <= 1; i += 0.25) {
            const w1LocalX = 15 + (-60 - 15) * i;
            const w1LocalY = 0 + (-70 - 0) * i;
            const w1X = localX + (w1LocalX * Math.cos(bird.rotation) - w1LocalY * Math.sin(bird.rotation)) * bird.scale;
            const w1Y = localY + (w1LocalX * Math.sin(bird.rotation) + w1LocalY * Math.cos(bird.rotation)) * bird.scale;
            spawnParticle(w1X, w1Y, (0.3 + Math.random() * 1.5) * bird.scale);

            const w2LocalX = 15 + (-60 - 15) * i;
            const w2LocalY = 0 + (70 - 0) * i;
            const w2X = localX + (w2LocalX * Math.cos(bird.rotation) - w2LocalY * Math.sin(bird.rotation)) * bird.scale;
            const w2Y = localY + (w2LocalX * Math.sin(bird.rotation) + w2LocalY * Math.cos(bird.rotation)) * bird.scale;
            spawnParticle(w2X, w2Y, (0.3 + Math.random() * 1.5) * bird.scale);
          }
        }
      });

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      particlesRef.current.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.life * 0.6;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      birdsRef.current.forEach(bird => {
        const localX = bird.x - offsetXRef.current;
        const localY = bird.y;

        if (localX < -200 || localX > canvas.width + 200) return;

        const birdColor = bird.color.startsWith('text-[') ? bird.color.replace('text-[', '').replace(']', '') : '#00FFFF';

        if (!bird.customImage) {
          bird.history.forEach((pos, idx) => {
            ctx.save();
            ctx.translate(pos.x - offsetXRef.current, pos.y);
            ctx.rotate(pos.rotation);
            ctx.scale(bird.scale * (1 - (idx + 1) * 0.15), bird.scale * (1 - (idx + 1) * 0.15));
            ctx.globalAlpha = 0.3 - (idx * 0.05);
            ctx.fillStyle = birdColor;
            drawBird(ctx, bird, birdColor, true);
            ctx.restore();
          });
        }

        ctx.save();
        ctx.translate(localX, localY);
        
        if (bird.customImage) {
          if (bird.vx > 0) {
            ctx.scale(-bird.scale, bird.scale);
          } else {
            ctx.scale(bird.scale, bird.scale);
          }
        } else {
          ctx.rotate(bird.rotation);
          ctx.scale(bird.scale, bird.scale);
        }
        
        ctx.globalAlpha = 1;
        ctx.fillStyle = birdColor;
        drawBird(ctx, bird, birdColor);
        ctx.restore();
      });

      animationFrameId = requestAnimationFrame(updatePositions);
    };

    const drawBird = (ctx: CanvasRenderingContext2D, bird: BirdInstance, color: string, isTrail: boolean = false) => {
      if (bird.customImage) {
        let img = imageCacheRef.current.get(bird.customImage);
        if (!img) {
          img = new Image();
          img.src = bird.customImage;
          imageCacheRef.current.set(bird.customImage, img);
        }
        if (img.complete) {
          ctx.drawImage(img, -40, -40, 80, 80);
          return;
        }
      }

      const defineBirdPath = (c: CanvasRenderingContext2D) => {
        c.beginPath();
        c.moveTo(35, 0);
        c.bezierCurveTo(20, -6, -10, -4, -40, -15);
        c.lineTo(-25, 0);
        c.lineTo(-40, 15);
        c.bezierCurveTo(-10, 4, 20, 6, 35, 0);
        c.moveTo(15, 0);
        c.bezierCurveTo(10, -35, -20, -60, -60, -70);
        c.bezierCurveTo(-35, -50, -10, -25, -5, 0);
        c.moveTo(15, 0);
        c.bezierCurveTo(10, 35, -20, 60, -60, 70);
        c.bezierCurveTo(-35, 50, -10, 25, -5, 0);
      };

      if (isCorruptedRef.current) {
        if (!corruptedCanvasesRef.current[color]) {
          const offCanvas = document.createElement('canvas');
          offCanvas.width = 160;
          offCanvas.height = 160;
          const offCtx = offCanvas.getContext('2d');
          if (offCtx) {
            offCtx.translate(80, 80);
            defineBirdPath(offCtx);
            offCtx.clip();
            offCtx.fillStyle = color;
            offCtx.font = "bold 12px monospace";
            offCtx.textAlign = "center";
            offCtx.textBaseline = "middle";
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            for (let y = -80; y <= 80; y += 10) {
              for (let x = -80; x <= 80; x += 10) {
                const char = chars[Math.floor(Math.random() * chars.length)];
                offCtx.fillText(char, x, y);
              }
            }
          }
          corruptedCanvasesRef.current[color] = offCanvas;
        }
        const cached = corruptedCanvasesRef.current[color];
        if (cached) {
          ctx.drawImage(cached, -80, -80);
          return;
        }
      }
      
      defineBirdPath(ctx);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.moveTo(32, 0);
      ctx.bezierCurveTo(25, -5, 10, -4, 5, 0);
      ctx.bezierCurveTo(10, 4, 25, 5, 32, 0);
      ctx.fill();
    };

    animationFrameId = requestAnimationFrame(updatePositions);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  const triggerAchievement = useCallback((name: string) => {
    if (!earnedAchievements.includes(name)) {
      setEarnedAchievements(current => [...current, name]);
      setAchievementName(name);
      setShowAchievement(true);
      setTimeout(() => setShowAchievement(false), 2000);
    }
  }, [earnedAchievements]);

  const spawnBirdAt = useCallback((x: number, y: number, isFlock: boolean = false, overrideVel?: {vx: number, vy: number}, imageOverride?: string) => {
    const scale = isFlock 
      ? (imageOverride || customBirdImage ? (0.8 + Math.random() * 0.4) : (0.1 + Math.random() * 0.2))
      : (imageOverride || customBirdImage ? (1.5 + Math.random() * 0.8) : (0.2 + Math.random() * 0.5));

    if (socketRef.current) {
      socketRef.current.emit('spawn_bird', { 
        x, 
        y, 
        vx: overrideVel?.vx, 
        vy: overrideVel?.vy, 
        scale,
        customImage: imageOverride || customBirdImage || undefined 
      });
    }
    
    const newCount = totalSpawned + 1;
    setTotalSpawned(newCount);
    playChirp();
    
    if (newCount === 1) {
      triggerAchievement("笨鸟先飞");
    } else if (newCount === 20) {
      triggerAchievement("鸿运当头");
    } else if (newCount === 100) {
      triggerAchievement("群英荟萃");
    }
  }, [totalSpawned, triggerAchievement, customBirdImage, playChirp]);

  const spawnFlock = useCallback((x: number, y: number, count: number = 10) => {
    for (let i = 0; i < count; i++) {
      spawnBirdAt(
        x + (Math.random() - 0.5) * 20, 
        y + (Math.random() - 0.5) * 20, 
        true
      );
    }
  }, [spawnBirdAt]);

  const handleReset = useCallback(() => {
    setIsResetting(true);
    if (socketRef.current) {
      socketRef.current.emit('clear_birds');
    }
    
    if (isSoundEnabled) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          const bufferSize = audioCtx.sampleRate * 2.5;
          const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
          }
          const noise = audioCtx.createBufferSource();
          noise.buffer = buffer;
          const filter = audioCtx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 3000;
          const gainNode = audioCtx.createGain();
          gainNode.gain.setValueAtTime(0.01, audioCtx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.5, audioCtx.currentTime + 2.3);
          gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 2.5);
          noise.connect(filter);
          filter.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          noise.start();
          setTimeout(() => {
            noise.stop();
            audioCtx.close().catch(() => {});
          }, 2500);
        }
      } catch (e) {
        console.error("Failed to play static sound", e);
      }
    }
    
    setTimeout(() => {
      particlesRef.current = [];
      setTotalSpawned(0);
      setClickCount(0);
      setCorruptedClickCount(0);
      setIsCorrupted(false);
      isCorruptedRef.current = false;
      setShowFileLostModal(false);
      setEarnedAchievements([]);
      setCustomBirdImage(null);
      setTimeout(() => {
        setIsResetting(false);
      }, 100);
    }, 2500);
  }, [isSoundEnabled]);

  const spawnBird = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (isResetting) return;
    if (isCorruptedRef.current) {
      if (isSoundEnabled) {
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            const audioCtx = new AudioContextClass();
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(150 + Math.random() * 800, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.1);
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.1);
            setTimeout(() => {
              audioCtx.close().catch(() => {});
            }, 200);
          }
        } catch (err) {
          console.error("Failed to play glitch sound", err);
        }
      }

      const nextCount = corruptedClickCount + 1;
      if (nextCount >= 10) {
        handleReset();
        return;
      }
      setCorruptedClickCount(nextCount);
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newClickCount = clickCount + 1;
    setClickCount(newClickCount);

    if (newClickCount === 35) {
      spawnFlock(x, y, 30);
      setShowFileLostModal(true);
      return;
    }

    spawnBirdAt(x, y, false);
  }, [spawnBirdAt, spawnFlock, clickCount, corruptedClickCount, isResetting, handleReset]);

  return (
    <div 
      ref={containerRef}
      className="w-screen h-screen bg-[#f4f1eb] overflow-hidden font-sans selection:bg-black/20 cursor-crosshair relative bg-cover bg-center"
      style={{ backgroundImage: `url(${backgroundImage})` }}
      onClick={spawnBird}
    >
      {/* Immersive Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-blue-500/5 blur-[160px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-indigo-500/5 blur-[160px] rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Fog Effect Layer - Removed for performance */}
      {/* <FogEffect /> */}

      {/* Birds Canvas Layer */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-10"
      />

      {/* Floating HUD - Top Left - Removed */}

      {/* Achievement Notification - Compact Elegant Ancient Style */}
      <AnimatePresence>
        {showAchievement && (
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="fixed top-12 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-5 bg-[#fdfcf0] border border-[#5A5A40]/30 px-6 py-3 shadow-xl pointer-events-none rounded-sm overflow-hidden"
          >
            {/* Rice Paper Texture Overlay */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />
            
            {/* Red Seal (印章) - Compact Style */}
            <motion.div 
              initial={{ scale: 1.5, rotate: -10, opacity: 0 }}
              animate={{ scale: 1, rotate: -2, opacity: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 150 }}
              className="relative w-10 h-10 flex items-center justify-center border-[2px] border-[#b91c1c] rounded-sm bg-[#b91c1c]/5"
            >
              <div className="absolute inset-0.5 border border-[#b91c1c]/20" />
              {achievementName === "惊弓之鸟" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transform -rotate-45">
                  <path d="M18 4 C 10 4, 10 20, 18 20" />
                  <polyline points="18 4 4 12 18 20" />
                  <line x1="4" y1="12" x2="22" y2="12" />
                  <polyline points="18 8 22 12 18 16" />
                </svg>
              ) : achievementName === "鸿运当头" ? (
                <Flame className="text-[#b91c1c]" size={20} strokeWidth={2.5} />
              ) : achievementName === "群英荟萃" ? (
                <Trophy className="text-[#b91c1c]" size={20} strokeWidth={2.5} />
              ) : (
                <Bird className="text-[#b91c1c]" size={20} strokeWidth={2.5} />
              )}
            </motion.div>

            {/* Horizontal Title */}
            <div className="flex flex-col justify-center">
              <span className="text-[8px] text-[#5A5A40]/60 font-serif font-bold tracking-[0.3em] uppercase leading-none mb-1">成就解锁</span>
              <span className="text-xl text-[#1a1a1a] font-serif tracking-[0.1em] font-medium leading-none">
                {achievementName}
              </span>
            </div>

            {/* Decorative Line */}
            <div className="w-[1px] h-6 bg-[#5A5A40]/20 mx-1" />
            <span className="text-[8px] text-[#5A5A40]/40 font-mono tracking-widest italic">UNLOCKED</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Music Removed */}
      <audio 
        ref={chirpAudioRef1} 
        src={chirpSound} 
        preload="auto" 
        onError={() => console.error("Chirp 1 failed to load")}
      />
      <audio 
        ref={chirpAudioRef2} 
        src={chirpSound} 
        preload="auto" 
        onError={() => console.error("Chirp 2 failed to load")}
      />
      <audio 
        ref={flapAudioRef}
        src="https://assets.mixkit.co/active_storage/sfx/2434/2434-preview.mp3" 
        loop
        preload="auto"
        onError={() => console.error("Flap sound failed to load")}
      />

      {/* Floating HUD - Bottom Right (On Frame) */}
      <div className="absolute bottom-5 right-12 z-[250] flex gap-3">
        <HUDButton 
          icon={<Pen size={20} />} 
          onClick={openDrawing} 
          label="画鸟儿"
          primary={true}
        />
      </div>

      {/* TV Static Overlay */}
      <AnimatePresence>
        {isResetting && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 2.3, ease: "easeIn" }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              className="fixed inset-0 z-[5000] pointer-events-none"
            >
              <TVStatic />
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0, 1] }}
              transition={{ duration: 2.5, times: [0, 0.92, 1] }}
              exit={{ opacity: 0, transition: { duration: 0.8, ease: "easeOut" } }}
              className="fixed inset-0 z-[5001] bg-black pointer-events-none"
            />
          </>
        )}
      </AnimatePresence>

      {/* Central Instruction - Removed */}

      {/* Birds Layer - Removed in favor of Canvas */}

      {/* Regions Layer */}
      {regions.map((region) => (
        <div
          key={region.id}
          className="absolute cursor-pointer transition-colors group border-2 bg-transparent border-transparent"
          style={{ 
            left: Math.min(region.x1, region.x2), 
            top: Math.min(region.y1, region.y2),
            width: Math.abs(region.x2 - region.x1),
            height: Math.abs(region.y2 - region.y1)
          }}
          onClick={(e) => { 
            e.stopPropagation(); 
            triggerAchievement("惊弓之鸟");
            const cx = Math.min(region.x1, region.x2) + Math.abs(region.x2 - region.x1) / 2;
            const cy = Math.min(region.y1, region.y2) + Math.abs(region.y2 - region.y1) / 2;
            if (socketRef.current) {
              socketRef.current.emit('scare', { x: cx, y: cy });
            }
            spawnFlock(cx, cy); 
          }}
        >
        </div>
      ))}

      {/* Drawing Window Modal - Now a floating panel in bottom-left */}
      <AnimatePresence>
        {isDrawingOpen && (
          <div className="fixed bottom-5 left-5 z-[1000] pointer-events-none">
            <motion.div 
              initial={{ y: 20, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.95 }}
              className="bg-stone-200/95 backdrop-blur-xl border border-stone-900/10 rounded-3xl p-3.5 w-[260px] shadow-[0_20px_50px_rgba(0,0,0,0.3)] relative pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                onClick={() => setIsDrawingOpen(false)}
                className="absolute top-5 right-5 text-stone-900/40 hover:text-stone-900 transition-colors"
              >
                <X size={20} />
              </button>

              <div className="mb-2">
                <h2 className="text-sm font-serif text-stone-900 tracking-widest uppercase italic">创作你的鸟儿</h2>
                <p className="text-[6px] text-stone-900/40 tracking-[0.2em] uppercase mt-0.5">在下方画布绘制，它将加入飞行</p>
              </div>

              <DrawingCanvas onSave={(img) => {
                setDrawingHistory(prev => [img, ...prev].slice(0, 10));
                // Clear global custom image so future birds are normal
                setCustomBirdImage(null);
                triggerAchievement("神笔马良");

                // Spawn exactly one bird with the new drawing at the center
                spawnBirdAt(window.innerWidth / 2, window.innerHeight / 2, false, undefined, img);
                
                setIsDrawingOpen(false);
              }} />

              {drawingHistory.length > 0 && (
                <div className="mt-3 pt-3 border-t border-stone-900/10">
                  <p className="text-[8px] text-stone-900/50 tracking-widest uppercase mb-2">历史记录</p>
                  <div className="grid grid-cols-5 gap-2 pb-1">
                    {drawingHistory.map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setCustomBirdImage(null);
                          spawnBirdAt(window.innerWidth / 2, window.innerHeight / 2, false, undefined, img);
                          setIsDrawingOpen(false);
                        }}
                        className="w-full aspect-square rounded-lg border border-stone-900/10 bg-white/50 overflow-hidden hover:border-stone-900/40 transition-colors"
                      >
                        <img src={img} alt="History" className="w-full h-full object-contain" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* File Lost Modal - Triggered on 35th click */}
      <AnimatePresence>
        {showFileLostModal && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/20 backdrop-blur-sm pointer-events-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#fdfcf0] border-2 border-[#b91c1c]/30 p-8 rounded-sm shadow-2xl max-w-sm w-full relative overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Rice Paper Texture */}
              <div className="absolute inset-0 opacity-[0.05] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/natural-paper.png')]" />
              
              <div className="relative z-10 flex flex-col items-center text-center">
                <div className="w-16 h-16 border-2 border-[#b91c1c] flex items-center justify-center mb-6 rotate-45">
                  <X size={32} className="text-[#b91c1c] -rotate-45" />
                </div>
                
                <h2 className="text-2xl font-serif text-stone-900 tracking-[0.2em] mb-4">文件已丢失</h2>
                <p className="text-sm text-stone-600 font-serif leading-relaxed mb-8">
                  在飞鸟的掠影中，某些记忆似乎随风而逝。系统无法找回指定的资源。
                </p>
                
                <button 
                  onClick={() => {
                    setShowFileLostModal(false);
                    setIsCorrupted(true);
                    isCorruptedRef.current = true;
                    
                    if (isSoundEnabled) {
                      try {
                        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                        if (AudioContextClass) {
                          const audioCtx = new AudioContextClass();
                          
                          // Button click sound
                          const clickOsc = audioCtx.createOscillator();
                          const clickGain = audioCtx.createGain();
                          clickOsc.type = 'sine';
                          clickOsc.frequency.setValueAtTime(800, audioCtx.currentTime);
                          clickOsc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.1);
                          clickGain.gain.setValueAtTime(0.3, audioCtx.currentTime);
                          clickGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
                          clickOsc.connect(clickGain);
                          clickGain.connect(audioCtx.destination);
                          clickOsc.start(audioCtx.currentTime);
                          clickOsc.stop(audioCtx.currentTime + 0.1);

                          // Glitch sound
                          const osc = audioCtx.createOscillator();
                          const gainNode = audioCtx.createGain();
                          
                          osc.type = 'sawtooth';
                          osc.frequency.setValueAtTime(50, audioCtx.currentTime + 0.1);
                          osc.frequency.linearRampToValueAtTime(800, audioCtx.currentTime + 0.6);
                          
                          gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime + 0.1);
                          gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
                          
                          osc.connect(gainNode);
                          gainNode.connect(audioCtx.destination);
                          
                          osc.start(audioCtx.currentTime + 0.1);
                          osc.stop(audioCtx.currentTime + 0.6);
                          
                          setTimeout(() => {
                            audioCtx.close().catch(() => {});
                          }, 700);
                        }
                      } catch (err) {
                        console.error("Failed to play sounds", err);
                      }
                    }
                  }}
                  className="px-12 py-2 border border-stone-900 text-stone-900 text-xs tracking-[0.3em] uppercase hover:bg-stone-900 hover:text-white transition-all duration-300"
                >
                  OK
                </button>
              </div>

              {/* Decorative Corner Seals */}
              <div className="absolute top-2 left-2 w-4 h-4 border-t border-l border-[#b91c1c]/20" />
              <div className="absolute bottom-2 right-2 w-4 h-4 border-b border-r border-[#b91c1c]/20" />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes float-slow {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(20px, -20px); }
        }
        @keyframes float-slower {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-30px, 15px); }
        }
        .animate-float-slow { animation: float-slow 15s ease-in-out infinite; }
        .animate-float-slower { animation: float-slower 25s ease-in-out infinite; }
        
        @keyframes sway-slow {
          0%, 100% { transform: rotate(-1.5deg); }
          50% { transform: rotate(1.5deg); }
        }
        .animate-sway-slow { animation: sway-slow 8s ease-in-out infinite; }

      `}</style>
    </div>
  );
}

// Custom SVG component for a sleek swallow/swift shape
function TVStatic() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', resize);
    resize();

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const imageData = ctx.createImageData(w, h);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const val = Math.random() * 255;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
        data[i + 3] = 255;
      }

      ctx.putImageData(imageData, 0, 0);
      
      // Add some scanlines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      for (let i = 0; i < h; i += 4) {
        ctx.fillRect(0, i, w, 2);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full opacity-80 bg-black" />;
}

function SolidBird({ isGliding, flapSpeed }: { isGliding: boolean, flapSpeed: number }) {
  return (
    <div className="relative w-20 h-20">
      <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
        {/* Left Wing - Swept back swallow wing */}
        <path
          d="M 65 50 C 60 15, 30 -10, -10 -20 C 15 0, 40 25, 45 50 Z"
          fill="currentColor"
        />
        
        {/* Right Wing - Swept back swallow wing */}
        <path
          d="M 65 50 C 60 85, 30 110, -10 120 C 15 100, 40 75, 45 50 Z"
          fill="currentColor"
        />

        {/* Body - Sleek swallow body with forked tail */}
        <path d="M 85 50 C 70 44, 40 46, 10 35 L 25 50 L 10 65 C 40 54, 70 56, 85 50 Z" fill="currentColor" />

        {/* Chest - Colored patch */}
        <path d="M 82 50 C 75 46, 60 47, 55 50 C 60 53, 75 54, 82 50 Z" fill="rgba(255, 255, 255, 0.5)" />
      </svg>
    </div>
  );
}

function HUDButton({ icon, onClick, label, danger = false, primary = false }: { icon: ReactNode, onClick: (e: MouseEvent) => void, label: string, danger?: boolean, primary?: boolean }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02, backgroundColor: primary ? '#f0e6d2' : danger ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)' }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`pointer-events-auto flex items-center gap-3 backdrop-blur-md transition-all ${
        primary 
          ? 'px-8 py-3.5 text-[#4a3f35] bg-[#f8f1e4] border border-[#c8b89e] rounded-sm shadow-[2px_2px_8px_rgba(0,0,0,0.15)] relative overflow-hidden before:absolute before:inset-0 before:bg-[url("https://www.transparenttextures.com/patterns/rice-paper.png")] before:opacity-30 before:pointer-events-none' 
          : danger 
            ? 'px-5 py-3 rounded-xl text-red-400 bg-red-500/10 border border-white/10 shadow-lg' 
            : 'px-5 py-3 rounded-xl text-white/70 bg-white/5 border border-white/10 shadow-lg'
      }`}
    >
      <div className="relative z-10 flex items-center gap-3">
        {icon}
        <span className={`${primary ? 'text-base font-serif font-medium tracking-[0.3em] ml-1' : 'text-[10px] font-black uppercase tracking-widest'}`}>{label}</span>
      </div>
    </motion.button>
  );
}

function DrawingCanvas({ onSave }: { onSave: (img: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(8);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set initial canvas state
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const saveState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHistory(prev => [...prev, canvas.toDataURL()]);
  };

  const startDrawing = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
    saveState();
    setIsDrawing(true);
    draw(e, true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
  };

  const draw = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>, force = false) => {
    if (!isDrawing && !force) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Scale coordinates based on canvas internal resolution vs displayed size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    ctx.lineWidth = brushSize;
    
    if (color === 'rgba(0,0,0,0)') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    saveState();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const undo = () => {
    if (history.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const previousState = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));

    const img = new Image();
    img.src = previousState;
    img.onload = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
    // Don't clear canvas here, let the parent component handle closing
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <div className="flex gap-0.5">
          {['#ffffff', '#000000', '#ff4444', '#44ff44', '#4444ff', '#ffff44'].map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-4 h-4 rounded-full border transition-transform ${color === c ? 'border-stone-900 scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <button
            onClick={() => setColor('rgba(0,0,0,0)')}
            className={`w-4 h-4 rounded-full border flex items-center justify-center bg-stone-300 transition-transform ${color === 'rgba(0,0,0,0)' ? 'border-stone-900 scale-110' : 'border-transparent'}`}
          >
            <Eraser size={8} className="text-stone-600" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[6px] text-stone-900/40 uppercase tracking-widest">笔触</span>
          <input 
            type="range" 
            min="1" 
            max="20" 
            value={brushSize} 
            onChange={(e) => setBrushSize(parseInt(e.target.value))}
            className="w-10 accent-stone-900"
          />
        </div>
      </div>

      <div className="relative aspect-square w-full bg-stone-100 rounded-2xl border border-stone-900/5 overflow-hidden cursor-crosshair">
        <canvas
          ref={canvasRef}
          width={400}
          height={400}
          className="w-full h-full"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseOut={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={undo}
          disabled={history.length === 0}
          className="flex-1 py-3 rounded-xl bg-stone-900/5 text-stone-600 uppercase text-[10px] tracking-[0.1em] font-bold hover:bg-stone-900/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Undo2 size={14} /> 撤回
        </button>
        <button
          onClick={clearCanvas}
          className="flex-1 py-3 rounded-xl bg-stone-900/5 text-stone-600 uppercase text-[10px] tracking-[0.1em] font-bold hover:bg-stone-900/10 transition-colors flex items-center justify-center gap-2"
        >
          <Trash2 size={14} /> 清空
        </button>
        <button
          onClick={handleSave}
          className="flex-[2] py-3 rounded-xl bg-stone-900 text-white uppercase text-[10px] tracking-[0.1em] font-bold hover:bg-stone-800 transition-colors flex items-center justify-center gap-2"
        >
          <Check size={14} /> 完成并使用
        </button>
      </div>
    </div>
  );
}
