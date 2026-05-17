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
    // Leaderboard Data
    kills: number;
    deaths: number;
    score: number;
    joinTime: number;
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
    shootInterval: 100,
    projectileSpeed: 300,
    meleeCooldown: 2000,
    meleeDamage: 25,
    meleeRange: 80,
    meleeArc: Math.PI,
    maxAmmo: 20,
    reloadTime: 2000,
    maxHp: 100,
    dashRecharge: 5000
};

const RAPID_STATS: PlayerStats = {
    ...INITIAL_STATS,
    baseSpeed: 225,
    shootInterval: 50,
    maxHp: 60,
    meleeDamage: 15
};

interface Projectile {
    id: string;
    ownerId: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
}

const players: { [id: string]: Player & { mode: string } } = {};
const modeStates: { [mode: string]: { projectiles: Projectile[] } } = {
    standard: { projectiles: [] },
    rapid: { projectiles: [] }
};

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

    socket.on('join', (data: { nickname: string, mode: string }) => {
        const mode = data.mode === 'rapid' ? 'rapid' : 'standard';
        const stats = mode === 'rapid' ? RAPID_STATS : INITIAL_STATS;

        players[socket.id] = {
            id: socket.id,
            mode: mode,
            x: Math.floor(Math.random() * (WORLD_WIDTH - 100)) + 50,
            y: Math.floor(Math.random() * (WORLD_HEIGHT - 100)) + 50,
            color: getRandomColor(),
            nickname: data.nickname || 'Guest',
            message: '',
            messageTime: 0,
            hp: stats.maxHp,
            stats: { ...stats },
            isDead: false,
            respawnTime: 0,
            kills: 0,
            deaths: 0,
            score: 0,
            joinTime: Date.now(),
            ammo: stats.maxAmmo,
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
        socket.join(mode);
        socket.emit('init', socket.id);
    });

    socket.on('get_leaderboard', () => {
        const playerList = Object.values(players).map(p => ({
            nickname: p.nickname,
            kills: p.kills,
            deaths: p.deaths,
            score: p.score,
            joinTime: p.joinTime,
            color: p.color
        })).sort((a, b) => b.score - a.score);
        socket.emit('leaderboard_data', playerList);
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
                if (victim.mode !== player.mode) continue; 
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
                            victim.deaths++;
                            player.kills++;
                            player.score += 10;
                            // Immediately move to next spawn position
                            victim.x = Math.floor(Math.random() * (WORLD_WIDTH - 100)) + 50;
                            victim.y = Math.floor(Math.random() * (WORLD_HEIGHT - 100)) + 50;
                        }
                    }
                }
            }
            io.to(player.mode).emit('melee_effect', { x: player.x, y: player.y, angle: angle, range: player.stats.meleeRange, arc: player.stats.meleeArc });
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

    socket.on('ping_check', (ts: number) => {
        socket.emit('pong', Date.now() - ts);
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
    
    // Process each mode
    for (const mode in modeStates) {
        let projectiles = modeStates[mode].projectiles;
        let projectilesToRemove = new Set<string>();

        // Update Projectiles and Collision
        for (let i = 0; i < projectiles.length; i++) {
            const p = projectiles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            for (const id in players) {
                const victim = players[id];
                if (victim.mode !== mode) continue; // Segregate by mode
                if (victim.isDead || id === p.ownerId || victim.isDashing) continue; 

                const dx = p.x - victim.x;
                const dy = p.y - victim.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < 20) { 
                    const attacker = players[p.ownerId];
                    if (attacker) {
                        victim.hp -= attacker.stats.meleeDamage / 2.5;
                        if (victim.hp <= 0) {
                            victim.hp = 0;
                            victim.isDead = true;
                            victim.respawnTime = now + 5000;
                            victim.deaths++;
                            attacker.kills++;
                            attacker.score += 10;
                            // Immediately move to next spawn position
                            victim.x = Math.floor(Math.random() * (WORLD_WIDTH - 100)) + 50;
                            victim.y = Math.floor(Math.random() * (WORLD_HEIGHT - 100)) + 50;
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

        modeStates[mode].projectiles = projectiles.filter(p => !projectilesToRemove.has(p.id));
    }

    // Update Players
    for (const id in players) {
        const player = players[id];
        const mode = player.mode;
        
        if (player.isDead && now >= player.respawnTime) {
            player.isDead = false;
            player.hp = player.stats.maxHp;
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
                    modeStates[mode].projectiles.push({
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

        // Survival Score Bonus (e.g., +1 score every 10 seconds)
        if (!player.isDead && (now - player.joinTime) % 10000 < 33) {
            player.score += 1;
        }
    }

    // Emit state per mode
    for (const mode in modeStates) {
        const modePlayers: { [id: string]: Player } = {};
        for (const id in players) {
            if (players[id].mode === mode) {
                modePlayers[id] = players[id];
            }
        }
        io.to(mode).emit('state', { 
            players: modePlayers, 
            projectiles: modeStates[mode].projectiles, 
            ts: Date.now() 
        });
    }
}, 1000 / 30);

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
