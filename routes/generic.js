const express = require("express");
const axios = require("axios");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const sharp = require("sharp"); // Using sharp for image processing
const pLimit = require("@esm2cjs/p-limit").default;
const authenticateToken = require("../middleware/authMiddleware");

/* GET route handler */
router.get("/", authenticateToken, async function (req, res) {
	try {
		// Assume imageUrls is an array of image URLs provided in the query parameters
		// e.g., ?imageUrls[]=url1&imageUrls[]=url2
		const imageUrls = req.query.imageUrls;

		if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
			return res.status(400).json({ error: "No image URLs provided." });
		}

		// Ensure data directory exists
		const dataFolder = path.join(__dirname.replace("routes", ""), "data");
		await fs.promises.mkdir(dataFolder, { recursive: true });

		// Limit concurrency to prevent resource exhaustion
		const limit = pLimit(3); // Adjust concurrency limit as needed

		// Process all images with limited concurrency
		const processingResults = await Promise.allSettled(
			imageUrls.map((imageUrl) =>
				limit(() => processImage(imageUrl, dataFolder))
			)
		);

		// Handle failed operations if necessary
		const failedImages = processingResults
			.filter((result) => result.status === "rejected")
			.map((result) => result.reason.filename || result.reason);

		if (failedImages.length > 0) {
			console.warn(
				`Failed to process images: ${failedImages.join(", ")}`
			);
		}

		// Send response back to client
		res.json({
			result: "ok",
			processedImages: processingResults
				.filter((result) => result.status === "fulfilled")
				.map((result) => result.value),
			failedImages: failedImages,
		});
	} catch (err) {
		console.error("Error in route handler:", err);
		res.status(500).send("Internal Server Error");
	}
});

// Function to process a single image
async function processImage(imageUrl, dataFolder) {
	try {
		// Parse the image URL
		const url = new URL(imageUrl);

		// Get the pathname and remove the leading '/'
		const pathname = url.pathname.startsWith("/")
			? url.pathname.substring(1)
			: url.pathname;
		// Split the pathname into parts
		const pathParts = pathname.split("/");

		// The last part is the image filename
		const imageFilename = pathParts.pop();

		// Remaining parts are the folder structure
		const folderStructure = pathParts.join(path.sep);

		// Create the full folder path
		const folderPath = path.join(dataFolder, folderStructure);

		// Ensure the folder exists
		await fs.promises.mkdir(folderPath, { recursive: true });

		// Full path to save the image
		const imagePath = path.join(folderPath, imageFilename);

		const finalURL =
			process.env.SITE +
			"/data/" +
			folderStructure.replace(/\\/g, "/") +
			"/" +
			imageFilename;

		// Check if the image file exists
		try {
			await fs.promises.access(imagePath);
			// File exists, skip processing
			return finalURL;
		} catch {
			// File does not exist, proceed to download and process
		}

		// Use streams to download and process the image
		const response = await axios({
			method: "get",
			url: imageUrl,
			headers: {
				referer: `https://${url.hostname}/`,
			},
			responseType: "stream", // Use stream for efficiency
		});

		return new Promise((resolve, reject) => {
			const transformStream = sharp()
				.trim({
					background: "#ffffff",
					threshold: 40,
				})
				.on("error", (err) => {
					console.error(
						`Error processing image ${imageFilename}:`,
						err
					);
					err.filename = imageFilename;
					reject(err);
				});

			const writableStream = fs
				.createWriteStream(imagePath)
				.on("error", (err) => {
					console.error(
						`Error writing image ${imageFilename} to disk:`,
						err
					);
					err.filename = imageFilename;
					reject(err);
				})
				.on("finish", () => {
					resolve(finalURL);
				});

			response.data
				.on("error", (err) => {
					console.error(
						`Error downloading image ${imageFilename}:`,
						err
					);
					err.filename = imageFilename;
					reject(err);
				})
				.pipe(transformStream)
				.pipe(writableStream);
		});
	} catch (err) {
		err.filename = imageUrl;
		throw err;
	}
}

module.exports = router;
