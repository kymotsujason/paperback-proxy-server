const express = require("express");
const fs = require("fs").promises;
const { createReadStream } = require("fs");
const path = require("path");
const mime = require("mime-types");
const sanitize = require("sanitize-filename");
const { pipeline } = require("stream");
const { promisify } = require("util");
const router = express.Router();

const pipelineAsync = promisify(pipeline);

// Helper function to wait for the image file
async function waitForFile(imagePath, timeout = 10000) {
	const endTime = Date.now() + timeout;
	let interval = 100; // Start interval at 100ms

	while (Date.now() < endTime) {
		try {
			await fs.access(imagePath);
			// File exists
			return true;
		} catch {
			// File does not exist yet, wait for the interval
			await new Promise((resolve) => setTimeout(resolve, interval));
			// Exponential backoff
			interval = Math.min(interval * 2, 800);
		}
	}
	// Timeout reached, file not found
	return false;
}

router.get("/*", async (req, res) => {
	// Extract and sanitize the relative path after '/data/'
	const relativePath = req.params[0];
	const pathSegments = relativePath.split("/").map(sanitize);
	const safePath = path.join(...pathSegments);

	// Prevent directory traversal
	const imagePath = path.join(
		__dirname.replace("routes", ""),
		"data",
		safePath
	);

	// Ensure the imagePath starts with the base data directory
	const dataDir = path.join(__dirname.replace("routes", ""), "data");
	if (!imagePath.startsWith(dataDir)) {
		res.status(400).send("Invalid path");
		return;
	}

	try {
		// Wait for the file to become available
		const fileExists = await waitForFile(imagePath);

		if (!fileExists) {
			res.status(404).send("Image not found");
			return;
		}

		// Determine the MIME type
		const contentType =
			mime.lookup(imagePath) || "application/octet-stream";
		res.setHeader("Content-Type", contentType);
		res.setHeader("Cache-Control", "public, max-age=31536000"); // Cache for 1 year

		// Stream the file to the client
		const readStream = createReadStream(imagePath);
		await pipelineAsync(readStream, res);
	} catch (error) {
		// Improved error logging
		console.error(`Error serving image ${safePath}:`, error);
		res.status(500).send("Internal Server Error");
	}
});

module.exports = router;
