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

interface PlayerStats {
    baseSpeed: number;
    shootInterval: number;
    projectileSpeed: number;
    meleeCooldown: number;
    meleeDamage: number;
    meleeRange: number;
    meleeArc: number;
    maxAmmo: number;
    reloadTime: number;
    maxHp: number;
    dashRecharge: number;
}

interface Player {
    id: string;
    x: number;
    y: number;
    color: string;
    nickname: string;
    message: string;
    messageTime: number;
    hp: number;
    stats: PlayerStats; // Centralized for upgrades
    isDead: boolean;
    respawnTime: number;
    // Combat State
    ammo: number;
    isReloading: boolean;
    reloadEndTime: number;
    lastShootTime: number;
    lastMeleeTime: number;
    // Dash State
    dashCharges: number;
    lastDashChargeTime: number;
    isDashing: boolean;
    dashEndTime: number;
    dashVx: number;
    dashVy: number;
    input?: { w: boolean, a: boolean, s: boolean, d: boolean, shooting: boolean, shootAngle: number };
}

const INITIAL_STATS: PlayerStats = {
    baseSpeed: 150,
    shootInterval: 100, // 0.1s as requested
    projectileSpeed: 300,
    meleeCooldown: 2000, // 2s as requested
    meleeDamage: 25,
    meleeRange: 80, // Doubled from 40
    meleeArc: Math.PI, // Doubled from 90 to 180 degrees
    maxAmmo: 20,
    reloadTime: 2000,
    maxHp: 100,
    dashRecharge: 5000
};

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
const DASH_DURATION_MS = 150; 
const DASH_SPEED = 750; 

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

    socket.on('join', (nickname: string) => {
        players[socket.id] = {
            id: socket.id,
            x: Math.floor(Math.random() * (WORLD_WIDTH - 100)) + 50,
            y: Math.floor(Math.random() * (WORLD_HEIGHT - 100)) + 50,
            color: getRandomColor(),
            nickname: nickname || 'Guest',
            message: '',
            messageTime: 0,
            hp: INITIAL_STATS.maxHp,
            stats: { ...INITIAL_STATS },
            isDead: false,
            respawnTime: 0,
            ammo: INITIAL_STATS.maxAmmo,
            isReloading: false,
            reloadEndTime: 0,
            lastShootTime: 0,
            lastMeleeTime: 0,
            dashCharges: MAX_DASH_CHARGES,
            lastDashChargeTime: Date.now(),
            isDashing: false,
            dashEndTime: 0,
            dashVx: 0,
            dashVy: 0
        };
        socket.emit('init', socket.id);
    });

    socket.on('input', (input: { w: boolean, a: boolean, s: boolean, d: boolean, shooting: boolean, shootAngle: number }) => {
        const player = players[socket.id];
        if (player && !player.isDead) {
            player.input = input;
        }
    });

    socket.on('reload', () => {
        const player = players[socket.id];
        if (player && !player.isDead && !player.isReloading && player.ammo < player.stats.maxAmmo) {
            player.isReloading = true;
            player.reloadEndTime = Date.now() + player.stats.reloadTime;
        }
    });

    socket.on('melee', (angle: number) => {
        const player = players[socket.id];
        const now = Date.now();
        if (player && !player.isDead && now - player.lastMeleeTime > player.stats.meleeCooldown) {
            player.lastMeleeTime = now;
            
            for (const id in players) {
                if (id === socket.id) continue;
                const victim = players[id];
                if (victim.isDead || victim.isDashing) continue;

                const dx = victim.x - player.x;
                const dy = victim.y - player.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < player.stats.meleeRange + 15) { 
                    let targetAngle = Math.atan2(dy, dx);
                    let angleDiff = Math.abs(targetAngle - angle);
                    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

                    if (angleDiff <= player.stats.meleeArc / 2) {
                        victim.hp -= player.stats.meleeDamage;
                        if (victim.hp <= 0) {
                            victim.hp = 0;
                            victim.isDead = true;
                            victim.respawnTime = now + 5000;
                        }
                    }
                }
            }
            io.emit('melee_effect', { x: player.x, y: player.y, angle: angle, range: player.stats.meleeRange, arc: player.stats.meleeArc });
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

    socket.on('chat', (msg: string) => {
        const player = players[socket.id];
        if (player) {
            player.message = msg.substring(0, 50); 
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
    const dt = (now - lastTickTime) / 1000; 
    lastTickTime = now;
    
    // Update Projectiles and Collision
    let projectilesToRemove = new Set<string>();

    for (let i = 0; i < projectiles.length; i++) {
        const p = projectiles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        for (const id in players) {
            const victim = players[id];
            if (victim.isDead || id === p.ownerId || victim.isDashing) continue; 

            const dx = p.x - victim.x;
            const dy = p.y - victim.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 20) { 
                const attacker = players[p.ownerId];
                if (attacker) {
                    victim.hp -= attacker.stats.meleeDamage / 2.5; // Projectile damage linked to melee/atk
                    if (victim.hp <= 0) {
                        victim.hp = 0;
                        victim.isDead = true;
                        victim.respawnTime = now + 5000;
                    }
                }
                projectilesToRemove.add(p.id);
            }
        }

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

        if (p.x < -50 || p.x > WORLD_WIDTH + 50 || p.y < -50 || p.y > WORLD_HEIGHT + 50) {
            projectilesToRemove.add(p.id);
        }
    }

    projectiles = projectiles.filter(p => !projectilesToRemove.has(p.id));

    for (const id in players) {
        const player = players[id];
        
        if (player.isDead && now >= player.respawnTime) {
            player.isDead = false;
            player.hp = player.stats.maxHp;
            player.x = Math.floor(Math.random() * (WORLD_WIDTH - 100)) + 50;
            player.y = Math.floor(Math.random() * (WORLD_HEIGHT - 100)) + 50;
            player.dashCharges = MAX_DASH_CHARGES;
            player.ammo = player.stats.maxAmmo;
            player.isReloading = false;
        }

        // Handle Reloading
        if (player.isReloading && now >= player.reloadEndTime) {
            player.ammo = player.stats.maxAmmo;
            player.isReloading = false;
        }

        // Handle Shooting (Auto-fire)
        if (!player.isDead && !player.isReloading && player.input?.shooting) {
            if (now - player.lastShootTime >= player.stats.shootInterval) {
                if (player.ammo > 0) {
                    player.ammo--;
                    player.lastShootTime = now;
                    const angle = player.input.shootAngle;
                    projectiles.push({
                        id: Math.random().toString(36).substr(2, 9),
                        ownerId: player.id,
                        x: player.x,
                        y: player.y,
                        vx: Math.cos(angle) * player.stats.projectileSpeed,
                        vy: Math.sin(angle) * player.stats.projectileSpeed
                    });
                } else {
                    player.isReloading = true;
                    player.reloadEndTime = now + player.stats.reloadTime;
                }
            }
        }

        if (player.dashCharges < MAX_DASH_CHARGES) {
            if (now - player.lastDashChargeTime >= player.stats.dashRecharge) {
                player.dashCharges++;
                player.lastDashChargeTime = now;
            }
        }

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
                player.x += (dx / mag) * player.stats.baseSpeed * dt;
                player.y += (dy / mag) * player.stats.baseSpeed * dt;
            }
        }

        player.x = Math.max(15, Math.min(WORLD_WIDTH - 15, player.x));
        player.y = Math.max(15, Math.min(WORLD_HEIGHT - 15, player.y));

        if (player.message && now - player.messageTime > 5000) {
            player.message = '';
        }
    }
    io.emit('state', { players, projectiles, ts: Date.now() });
}, 1000 / 30);

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
