const express = require("express");
const axios = require("axios");
const router = express.Router();
const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp"); // Using sharp for image processing
const pLimit = require("@esm2cjs/p-limit").default;
const authenticateToken = require("../middleware/authMiddleware");

/* GET route handler */
router.get("/", authenticateToken, async function (req, res) {
	try {
		const mangadexApi = `https://api.mangadex.org/at-home/server/${req.query.chapterId}`;

		const response = await axios.get(mangadexApi);

		if (response.data.result === "ok") {
			// Extract baseUrl and chapterHash
			const originalBaseUrl = response.data.baseUrl; // Keep the original baseUrl for internal use
			const chapterHash = response.data.chapter.hash;
			const imageFilenames = response.data.chapter.data; // Array of image filenames

			// Ensure data directory and chapter folder exist
			const dataFolder = path.join(
				__dirname.replace("routes", ""),
				"data"
			);
			const chapterFolder = path.join(dataFolder, chapterHash);

			// Create data folder and chapter folder asynchronously
			await fs.mkdir(chapterFolder, { recursive: true });

			// Start processing images asynchronously
			processImages(
				originalBaseUrl,
				chapterHash,
				imageFilenames,
				chapterFolder
			).catch((err) => {
				console.error("Error processing images:", err);
			});

			// Replace baseUrl in response data
			const baseUrl = process.env.SITE;
			response.data.baseUrl = baseUrl;

			// Send response back to client immediately
			res.json({
				...response.data,
				message:
					"Images are being processed and will be available shortly.",
			});
		} else {
			// Handle API error response
			res.status(404).json({
				result: "error",
				errors: response.data.errors || [],
			});
		}
	} catch (err) {
		console.error("Error in route handler:", err);
		res.status(500).send("Internal Server Error");
	}
});

// Function to process all images asynchronously
async function processImages(
	baseUrl,
	chapterHash,
	imageFilenames,
	chapterFolder
) {
	try {
		// Limit concurrency to prevent resource exhaustion
		const limit = pLimit(3); // Adjust concurrency limit as needed

		// Process all images with limited concurrency
		await Promise.allSettled(
			imageFilenames.map((imageFilename) =>
				limit(() =>
					processImage(
						baseUrl,
						chapterHash,
						imageFilename,
						chapterFolder
					)
				)
			)
		);
	} catch (err) {
		// Log any errors
		console.error("Error in processImages:", err);
		throw err;
	}
}

// Function to process a single image
async function processImage(
	baseUrl,
	chapterHash,
	imageFilename,
	chapterFolder
) {
	const imagePath = path.join(chapterFolder, imageFilename);

	try {
		// Check if the image file exists asynchronously
		await fs.access(imagePath);
		// File exists, skip processing
		return { success: true, filename: imageFilename, skipped: true };
	} catch {
		try {
			// File does not exist, proceed to download and process
			const imageUrl = `${baseUrl}/data/${chapterHash}/${imageFilename}`;

			// Download the image into a buffer
			const response = await axios.get(imageUrl, {
				headers: {
					referer: `${baseUrl}/`,
				},
				responseType: "arraybuffer",
			});

			const imageBuffer = Buffer.from(response.data);

			// Get image metadata
			const metadata = await sharp(imageBuffer).metadata();

			// Calculate the aspect ratio
			const aspectRatio = metadata.width / metadata.height;

			// Prepare the Sharp transformer
			let transformer = sharp(imageBuffer);

			if (aspectRatio < 1.6) {
				// Apply trimming and convert to WebP
				transformer = transformer
					.trim({
						background: "#ffffff",
						threshold: 40,
					})
					.webp({ quality: 75, effort: 6 });
			}

			// Save the processed image to disk
			await transformer.toFile(imagePath);

			return { success: true, filename: imageFilename };
		} catch (err) {
			err.filename = imageFilename;
			throw err;
		}
	}
}

module.exports = router;
