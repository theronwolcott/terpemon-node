const express = require('express');
const rawBody = require('raw-body'); // Import raw-body
const app = express();

// Middleware to capture the raw request body (before parsing as JSON)
app.use((req, res, next) => {
    // Capture the raw body as a Buffer
    rawBody(req, {
        length: req.headers['content-length'],
        encoding: 'utf-8'
    }, (err, body) => {
        if (err) {
            return next(err);
        }

        console.log('Raw Body:', body);  // Log the raw body here
        req.rawBody = body;  // Store it for further use

        // After capturing the raw body, we need to parse it using express.json()
        req.body = JSON.parse(body); // Manually parse the body if it's JSON

        next();
    });
});

// Middleware to parse JSON request body
// Remove express.json() because we are already handling it manually

// Example route that you can test
app.post('*', (req, res) => {
    console.log('Parsed Body:', req.body);  // This will show the manually parsed JSON
    //   res.send('Received POST request');
    res.json([]);
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
