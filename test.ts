import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('Starting server test...');

const message = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
        name: 'chat-completion',
        arguments: {
            messages: [{
                role: 'user',
                content: 'What is 2+2?'
            }],
            temperature: 0.7,
            max_tokens: 100
        }
    }
};

// Handle server output
process.stdout.on('data', (data) => {
    console.log('Server output:', data.toString().trim());
});

process.stdout.on('error', (error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

process.stdout.on('end', () => {
    console.log('Server exited');
});

// Send a test message
console.log('Waiting to send test message...');
setTimeout(() => {
    console.log('Sending test message...');
    try {
        process.stdout.write(JSON.stringify(message) + '\n');
        console.log('Test message sent successfully');
    } catch (error) {
        console.error('Failed to send test message:', error);
    }
}, 1000);

// Clean up after 5 seconds
setTimeout(() => {
    console.log('Cleaning up...');
    process.exit(0);
}, 5000);
