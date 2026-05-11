import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static(path.join(__dirname, '../public')));

interface Player {
    id: string;
    x: number;
    y: number;
    color: string;
    nickname: string;
    targetX: number | null;
    targetY: number | null;
    message: string;
    messageTime: number;
}

const players: { [id: string]: Player } = {};

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
            x: Math.floor(Math.random() * 700) + 50,
            y: Math.floor(Math.random() * 500) + 50,
            color: getRandomColor(),
            nickname: nickname || 'Guest',
            targetX: null,
            targetY: null,
            message: '',
            messageTime: 0
        };
        socket.emit('init', socket.id);
    });

    socket.on('input', (input: { w: boolean, a: boolean, s: boolean, d: boolean }) => {
        const player = players[socket.id];
        if (player) {
            const speed = 5;
            let moved = false;
            if (input.w) { player.y -= speed; moved = true; }
            if (input.s) { player.y += speed; moved = true; }
            if (input.a) { player.x -= speed; moved = true; }
            if (input.d) { player.x += speed; moved = true; }

            if (moved) {
                // Keyboard move cancels mouse move
                player.targetX = null;
                player.targetY = null;
            }

            // Simple boundary check
            player.x = Math.max(15, Math.min(785, player.x));
            player.y = Math.max(15, Math.min(585, player.y));
        }
    });

    socket.on('move-to', (pos: { x: number, y: number }) => {
        const player = players[socket.id];
        if (player) {
            player.targetX = pos.x;
            player.targetY = pos.y;
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

// Server Tick Loop (30Hz)
setInterval(() => {
    const now = Date.now();
    for (const id in players) {
        const player = players[id];
        
        // Handle mouse movement
        if (player.targetX !== null && player.targetY !== null) {
            const dx = player.targetX - player.x;
            const dy = player.targetY - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const speed = 5;

            if (distance < speed) {
                player.x = player.targetX;
                player.y = player.targetY;
                player.targetX = null;
                player.targetY = null;
            } else {
                player.x += (dx / distance) * speed;
                player.y += (dy / distance) * speed;
            }
        }

        // Clear chat messages after 5 seconds
        if (player.message && now - player.messageTime > 5000) {
            player.message = '';
        }
    }
    io.emit('state', players);
}, 1000 / 30);

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
