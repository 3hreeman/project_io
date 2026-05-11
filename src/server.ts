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

    // Create new player
    players[socket.id] = {
        id: socket.id,
        x: Math.floor(Math.random() * 700) + 50,
        y: Math.floor(Math.random() * 500) + 50,
        color: getRandomColor()
    };

    // Send initial state to the new player
    socket.emit('init', socket.id);

    socket.on('input', (input: { w: boolean, a: boolean, s: boolean, d: boolean }) => {
        const player = players[socket.id];
        if (player) {
            const speed = 5;
            if (input.w) player.y -= speed;
            if (input.s) player.y += speed;
            if (input.a) player.x -= speed;
            if (input.d) player.x += speed;

            // Simple boundary check
            player.x = Math.max(0, Math.min(800, player.x));
            player.y = Math.max(0, Math.min(600, player.y));
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete players[socket.id];
    });
});

// Server Tick Loop (30Hz)
setInterval(() => {
    io.emit('state', players);
}, 1000 / 30);

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
