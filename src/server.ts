import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

const WORLD_WIDTH = 1024;
const WORLD_HEIGHT = 576;

app.use(express.static(path.join(__dirname, '../public')));

interface Player {
    id: string;
    x: number;
    y: number;
    color: string;
    nickname: string;
    message: string;
    messageTime: number;
    hp: number;
    maxHp: number;
    atk: number;
    isDead: boolean;
    respawnTime: number;
    // Dash System
    dashCharges: number;
    lastDashChargeTime: number;
    isDashing: boolean;
    dashEndTime: number;
    dashVx: number;
    dashVy: number;
    input?: { w: boolean, a: boolean, s: boolean, d: boolean };
}

interface Projectile {
    id: string;
    ownerId: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
}

const players: { [id: string]: Player } = {};
let projectiles: Projectile[] = [];

const MAX_DASH_CHARGES = 2;
const DASH_RECHARGE_MS = 5000;
const DASH_DURATION_MS = 150; 
const BASE_SPEED = 150; // Pixels per second
const PROJECTILE_SPEED = 300; // Pixels per second
const DASH_SPEED = 750; // Pixels per second

const getRandomColor = () => {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Initial state: waiting for 'join' event
    socket.on('join', (nickname: string) => {
        players[socket.id] = {
            id: socket.id,
            x: Math.floor(Math.random() * (WORLD_WIDTH - 100)) + 50,
            y: Math.floor(Math.random() * (WORLD_HEIGHT - 100)) + 50,
            color: getRandomColor(),
            nickname: nickname || 'Guest',
            message: '',
            messageTime: 0,
            hp: 100,
            maxHp: 100,
            atk: 10,
            isDead: false,
            respawnTime: 0,
            dashCharges: MAX_DASH_CHARGES,
            lastDashChargeTime: Date.now(),
            isDashing: false,
            dashEndTime: 0,
            dashVx: 0,
            dashVy: 0
        };
        socket.emit('init', socket.id);
    });

    socket.on('input', (input: { w: boolean, a: boolean, s: boolean, d: boolean }) => {
        const player = players[socket.id];
        if (player && !player.isDead && !player.isDashing) {
            player.input = input;
        }
    });

    socket.on('dash', (dir: { x: number, y: number }) => {
        const player = players[socket.id];
        if (player && !player.isDead && !player.isDashing && player.dashCharges > 0) {
            const now = Date.now();
            const angle = Math.atan2(dir.y, dir.x);
            
            player.isDashing = true;
            player.dashEndTime = now + DASH_DURATION_MS;
            player.dashVx = Math.cos(angle) * DASH_SPEED;
            player.dashVy = Math.sin(angle) * DASH_SPEED;
            
            player.dashCharges--;
            if (player.dashCharges === MAX_DASH_CHARGES - 1) {
                player.lastDashChargeTime = now;
            }
        }
    });

    socket.on('shoot', (dir: { x: number, y: number }) => {
        const player = players[socket.id];
        if (player && !player.isDead) {
            const angle = Math.atan2(dir.y, dir.x);
            projectiles.push({
                id: Math.random().toString(36).substr(2, 9),
                ownerId: socket.id,
                x: player.x,
                y: player.y,
                vx: Math.cos(angle) * PROJECTILE_SPEED,
                vy: Math.sin(angle) * PROJECTILE_SPEED
            });
        }
    });

    socket.on('chat', (msg: string) => {
        const player = players[socket.id];
        if (player) {
            player.message = msg.substring(0, 50); // Limit chat length
            player.messageTime = Date.now();
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete players[socket.id];
    });
});

let lastTickTime = Date.now();

// Server Tick Loop (30Hz)
setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTickTime) / 1000; // Delta time in seconds
    lastTickTime = now;
    
    // Update Projectiles and Collision
    let projectilesToRemove = new Set<string>();

    for (let i = 0; i < projectiles.length; i++) {
        const p = projectiles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // 1. Collision Check with Players
        for (const id in players) {
            const victim = players[id];
            if (victim.isDead || id === p.ownerId || victim.isDashing) continue; 

            const dx = p.x - victim.x;
            const dy = p.y - victim.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 20) { 
                const attacker = players[p.ownerId];
                if (attacker) {
                    victim.hp -= attacker.atk;
                    if (victim.hp <= 0) {
                        victim.hp = 0;
                        victim.isDead = true;
                        victim.respawnTime = now + 5000;
                    }
                }
                projectilesToRemove.add(p.id);
            }
        }

        // 2. Collision Check with other Projectiles
        for (let j = i + 1; j < projectiles.length; j++) {
            const p2 = projectiles[j];
            if (p.ownerId === p2.ownerId) continue; 

            const dx = p.x - p2.x;
            const dy = p.y - p2.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 10) { 
                projectilesToRemove.add(p.id);
                projectilesToRemove.add(p2.id);
            }
        }

        // 3. Remove projectiles that go off-screen
        if (p.x < -50 || p.x > WORLD_WIDTH + 50 || p.y < -50 || p.y > WORLD_HEIGHT + 50) {
            projectilesToRemove.add(p.id);
        }
    }

    projectiles = projectiles.filter(p => !projectilesToRemove.has(p.id));

    for (const id in players) {
        const player = players[id];
        
        // Handle Respawn
        if (player.isDead && now >= player.respawnTime) {
            player.isDead = false;
            player.hp = player.maxHp;
            player.x = Math.floor(Math.random() * (WORLD_WIDTH - 100)) + 50;
            player.y = Math.floor(Math.random() * (WORLD_HEIGHT - 100)) + 50;
            player.dashCharges = MAX_DASH_CHARGES;
        }

        // Handle Dash recharge
        if (player.dashCharges < MAX_DASH_CHARGES) {
            if (now - player.lastDashChargeTime >= DASH_RECHARGE_MS) {
                player.dashCharges++;
                player.lastDashChargeTime = now;
            }
        }

        // Handle Movement and Dash
        if (player.isDashing) {
            if (now >= player.dashEndTime) {
                player.isDashing = false;
            } else {
                player.x += player.dashVx * dt;
                player.y += player.dashVy * dt;
            }
        } else if (!player.isDead && player.input) {
            let dx = 0;
            let dy = 0;
            if (player.input.w) dy -= 1;
            if (player.input.s) dy += 1;
            if (player.input.a) dx -= 1;
            if (player.input.d) dx += 1;

            if (dx !== 0 || dy !== 0) {
                const mag = Math.sqrt(dx * dx + dy * dy);
                player.x += (dx / mag) * BASE_SPEED * dt;
                player.y += (dy / mag) * BASE_SPEED * dt;
            }
        }

        // Boundary check
        player.x = Math.max(15, Math.min(WORLD_WIDTH - 15, player.x));
        player.y = Math.max(15, Math.min(WORLD_HEIGHT - 15, player.y));

        // Clear chat messages after 5 seconds
        if (player.message && now - player.messageTime > 5000) {
            player.message = '';
        }
    }
    io.emit('state', { players, projectiles, ts: Date.now() });
}, 1000 / 30);

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
