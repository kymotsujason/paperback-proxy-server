var express = require("express");
var axios = require("axios");
var router = express.Router();
const fs = require("fs");
const path = require("path");
const sharp = require("sharp"); // Using sharp for image processing
const pLimit = require("@esm2cjs/p-limit").default;
const authenticateToken = require("../middleware/authMiddleware");

/* GET route handler */
router.get("/", authenticateToken, async function (req, res) {
	try {
		let mangadexApi = `https://api.mangadex.org/at-home/server/${req.query.chapterId}`;

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
			await fs.promises.mkdir(chapterFolder, { recursive: true });

			// Limit concurrency to prevent resource exhaustion
			const limit = pLimit(3); // Adjust concurrency limit as needed

			// Process all images with limited concurrency
			const processingResults = await Promise.allSettled(
				imageFilenames.map((imageFilename) =>
					limit(() =>
						processImage(
							originalBaseUrl,
							chapterHash,
							imageFilename,
							chapterFolder
						)
					)
				)
			);

			// Handle failed operations if necessary
			const failedImages = processingResults
				.filter((result) => result.status === "rejected")
				.map((result) => result.reason.filename);

			if (failedImages.length > 0) {
				console.warn(
					`Failed to process images: ${failedImages.join(", ")}`
				);
				// Optionally, you can inform the client about failed images
			}

			// Replace baseUrl in response data and escape forward slashes
			const baseUrl = process.env.SITE;
			response.data.baseUrl = baseUrl;

			// Send response back to client using res.json to ensure proper JSON formatting
			res.json({
				...response.data,
				failedImages: failedImages,
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
		await fs.promises.access(imagePath);
		// File exists
		//console.log(
		//	`Image ${imageFilename} already exists in ${chapterHash} folder. Skipping download and processing.`
		//);
		return { success: true, filename: imageFilename, skipped: true };
	} catch {
		// File does not exist, proceed to download and process
		//console.log(
		//	`Image ${imageFilename} does not exist in ${chapterHash} folder. Downloading and processing.`
		//);
		const imageUrl = `${baseUrl}/data/${chapterHash}/${imageFilename}`;

		// Use streams to download and process the image
		const response = await axios({
			method: "get",
			url: imageUrl,
			headers: {
				referer: `${baseUrl}/`,
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
					//console.log(
					//	`Image ${imageFilename} downloaded and processed.`
					//);
					resolve({ success: true, filename: imageFilename });
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
	}
}

module.exports = router;
