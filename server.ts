import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: '*',
    }
  });
  const PORT = 3000;

  // Global state
  let clients: { id: string; width: number; height: number; offsetX: number }[] = [];
  let birds: any[] = [];
  let particles: any[] = [];
  let globalWidth = 800;
  let globalHeight = 600;
  let birdIdCounter = 0;

  const BIRD_COLORS = [
    'text-[#00FFFF]',
    'text-[#00F5FF]',
    'text-[#00E5EE]',
    'text-[#7FFFD4]',
    'text-[#00FFD1]',
    'text-[#5FFFFF]'
  ];

  function updateGlobalDimensions() {
    let currentX = 0;
    let maxHeight = 600;
    clients.forEach(client => {
      client.offsetX = currentX;
      currentX += client.width;
      if (client.height > maxHeight) maxHeight = client.height;
    });
    globalWidth = Math.max(800, currentX);
    globalHeight = maxHeight;
    io.emit('layout_update', { clients, globalWidth, globalHeight });
  }

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join', (data: { width: number; height: number }) => {
      clients.push({
        id: socket.id,
        width: data.width,
        height: data.height,
        offsetX: 0
      });
      updateGlobalDimensions();
      socket.emit('init', { birds, clients, globalWidth, globalHeight });
    });

    socket.on('resize', (data: { width: number; height: number }) => {
      const client = clients.find(c => c.id === socket.id);
      if (client) {
        client.width = data.width;
        client.height = data.height;
        updateGlobalDimensions();
      }
    });

    socket.on('spawn_bird', (data: { x: number; y: number; vx?: number; vy?: number; scale?: number; customImage?: string }) => {
      const client = clients.find(c => c.id === socket.id);
      if (!client) return;
      
      const globalX = data.x + client.offsetX;
      const globalY = data.y;

      birds.push({
        id: birdIdCounter++,
        x: globalX,
        y: globalY,
        vx: data.vx !== undefined ? data.vx : (Math.random() - 0.5) * 10,
        vy: data.vy !== undefined ? data.vy : (Math.random() - 0.5) * 10,
        color: BIRD_COLORS[Math.floor(Math.random() * BIRD_COLORS.length)],
        rotation: 0,
        scale: data.scale !== undefined ? data.scale : 0.5 + Math.random() * 0.5,
        flapSpeed: 0.2 + Math.random() * 0.2,
        isGliding: false,
        glideTimer: 0,
        customImage: data.customImage
      });
    });

    socket.on('scare', (data: { x: number; y: number }) => {
      const client = clients.find(c => c.id === socket.id);
      if (!client) return;
      
      const globalX = data.x + client.offsetX;
      const globalY = data.y;

      // Apply scare force to birds
      birds.forEach(bird => {
        const dx = bird.x - globalX;
        const dy = bird.y - globalY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 300) {
          const force = (300 - dist) / 300;
          bird.vx += (dx / dist) * force * 20;
          bird.vy += (dy / dist) * force * 20;
        }
      });
    });

    socket.on('clear_birds', () => {
      birds = [];
      io.emit('birds_cleared');
    });

    socket.on('disconnect', () => {
      clients = clients.filter(c => c.id !== socket.id);
      updateGlobalDimensions();
    });
  });

  // Simulation loop (30 fps)
  setInterval(() => {
    if (clients.length === 0 && birds.length === 0) return;

    const ALIGNMENT = 0.05;
    const COHESION = 0.005;
    const SEPARATION = 0.05;
    const MAX_SPEED = 6;
    const MAX_FORCE = 0.2;
    const VISUAL_RANGE = 100;

    birds.forEach(bird => {
      let centerX = 0, centerY = 0;
      let alignX = 0, alignY = 0;
      let sepX = 0, sepY = 0;
      let count = 0;

      birds.forEach(other => {
        if (bird.id === other.id) return;
        const dx = bird.x - other.x;
        const dy = bird.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < VISUAL_RANGE) {
          centerX += other.x;
          centerY += other.y;
          alignX += other.vx;
          alignY += other.vy;
          count++;

          if (dist < 30) {
            sepX += dx;
            sepY += dy;
          }
        }
      });

      if (count > 0) {
        centerX /= count;
        centerY /= count;
        alignX /= count;
        alignY /= count;

        bird.vx += (centerX - bird.x) * COHESION;
        bird.vy += (centerY - bird.y) * COHESION;
        bird.vx += alignX * ALIGNMENT;
        bird.vy += alignY * ALIGNMENT;
      }

      bird.vx += sepX * SEPARATION;
      bird.vy += sepY * SEPARATION;

      // Speed limits
      const speed = Math.sqrt(bird.vx * bird.vx + bird.vy * bird.vy);
      if (speed > MAX_SPEED) {
        bird.vx = (bird.vx / speed) * MAX_SPEED;
        bird.vy = (bird.vy / speed) * MAX_SPEED;
      }

      // Boundaries (Global)
      const margin = 50;
      if (bird.x < margin) bird.vx += MAX_FORCE;
      if (bird.x > globalWidth - margin) bird.vx -= MAX_FORCE;
      if (bird.y < margin) bird.vy += MAX_FORCE;
      if (bird.y > globalHeight - margin) bird.vy -= MAX_FORCE;

      bird.x += bird.vx;
      bird.y += bird.vy;

      // Gliding logic
      bird.glideTimer--;
      if (bird.glideTimer <= 0) {
        bird.isGliding = !bird.isGliding;
        bird.glideTimer = bird.isGliding ? 30 + Math.random() * 60 : 20 + Math.random() * 40;
      }

      // Calculate rotation
      const targetRotation = Math.atan2(bird.vy, bird.vx);
      let diff = targetRotation - bird.rotation;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      bird.rotation += diff * 0.1;
    });

    // Broadcast state
    io.emit('state_update', { birds });
  }, 1000 / 30);

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
