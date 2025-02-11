const express = require("express");
const axios = require("axios");
const router = express.Router();
const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");
const pLimit = require("@esm2cjs/p-limit").default;
const authenticateToken = require("../middleware/authMiddleware");

router.get("/", authenticateToken, async function (req, res) {
	try {
		// Extract image URLs from query parameters
		const imageUrls = req.query.imageUrls;

		if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
			return res.status(400).json({ error: "No image URLs provided." });
		}

		// Ensure data directory exists
		const dataFolder = path.join(__dirname.replace("routes", ""), "data");
		await fs.mkdir(dataFolder, { recursive: true });

		// Process images asynchronously
		processImages(imageUrls, dataFolder).catch((err) => {
			console.error("Error processing images:", err);
		});

		// Prepare the response with the intended image URLs
		const processedImages = imageUrls.map((imageUrl) =>
			getFinalURL(imageUrl)
		);

		// Send response back to client immediately
		res.json({
			result: "ok",
			processedImages: processedImages,
			message:
				"Images are being processed and will be available shortly.",
		});
	} catch (err) {
		console.error("Error in route handler:", err);
		res.status(500).send("Internal Server Error");
	}
});

// Function to process images asynchronously
async function processImages(imageUrls, dataFolder) {
	const limit = pLimit(3); // Adjust concurrency limit as needed

	await Promise.all(
		imageUrls.map((imageUrl) =>
			limit(() => processImage(imageUrl, dataFolder))
		)
	);
}

// Function to get the final URL for an image
function getFinalURL(imageUrl) {
	const url = new URL(imageUrl);

	// Get the pathname without leading '/'
	const pathname = url.pathname.replace(/^\/+/, "");
	// Construct the final URL
	const finalURL = `${process.env.SITE}/data/${pathname}`;

	return finalURL;
}

// Function to process a single image
async function processImage(imageUrl, dataFolder) {
	try {
		const url = new URL(imageUrl);

		// Get the pathname and split into parts
		const pathname = url.pathname.replace(/^\/+/, "");
		const pathParts = pathname.split("/");

		// Filename and folder structure
		const imageFilename = pathParts.pop();
		const folderStructure = pathParts.join(path.sep);

		const folderPath = path.join(dataFolder, folderStructure);

		// Ensure the folder exists
		await fs.mkdir(folderPath, { recursive: true });

		const imagePath = path.join(folderPath, imageFilename);

		// Skip processing if the image already exists
		try {
			await fs.access(imagePath);
			return;
		} catch {
			// File does not exist, proceed to download and process
		}

		// Download the image
		const response = await axios.get(imageUrl, {
			responseType: "arraybuffer",
			headers: {
				referer: `https://${url.hostname}/`,
			},
		});

		const imageBuffer = Buffer.from(response.data);

		// Get image metadata to determine if it's a webtoon
		const metadata = await sharp(imageBuffer).metadata();

		const aspectRatio = metadata.height / metadata.width;
		const isWebtoon = aspectRatio > 1.6; // Adjust threshold if needed

		let transformer = sharp(imageBuffer);

		if (!isWebtoon) {
			// Apply trimming and convert to WebP
			transformer = transformer
				.trim({
					background: "#ffffff",
					threshold: 40,
				})
				.webp({ quality: 75, effort: 6 });
		}

		// Save the processed image
		await transformer.toFile(imagePath);
	} catch (err) {
		console.error(`Error processing image ${imageUrl}:`, err);
		// Handle specific errors if necessary
	}
}

module.exports = router;
