const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

// Serve static files from the 'arbitrage-site' folder
app.use(express.static(path.join(__dirname, 'arbitrage-site')));

// Endpoint to get transactions
app.get('/api/transactions', (req, res) => {
    const filePath = 'Logs/transactions.json';
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read transactions file' });
        }
        res.json(JSON.parse(data));
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
