const express = require("express");
const axios = require("axios");
const router = express.Router();
const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");
const pLimit = require("@esm2cjs/p-limit").default;
const authenticateToken = require("../middleware/authMiddleware");

// Helper function to download an image into a buffer
async function downloadImageBuffer(imageUrl) {
	const url = new URL(imageUrl);
	const response = await axios.get(imageUrl, {
		responseType: "arraybuffer",
		headers: {
			referer: `https://${url.hostname}/`,
		},
	});
	return Buffer.from(response.data);
}

// Function to process a single image
async function processImage(imageUrl, dataFolder, imageBuffer = null) {
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
			return { success: true };
		} catch {
			// File does not exist, proceed to download and process
		}

		// Use provided imageBuffer or download the image
		if (!imageBuffer) {
			imageBuffer = await downloadImageBuffer(imageUrl);
		}

		// Get image metadata
		const metadata = await sharp(imageBuffer).metadata();

		// Determine if the image is a webtoon based on aspect ratio
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

		return {
			success: true,
			height: metadata.height,
			isWebtoon,
		};
	} catch (err) {
		console.error(`Error processing image ${imageUrl}:`, err);
		return { success: false, error: err };
	}
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

// Route handler
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

		// Download the first image to perform the check
		const firstImageUrl = imageUrls[0];
		const firstImageBuffer = await downloadImageBuffer(firstImageUrl);

		// Process the first image and get metadata
		const firstImageResult = await processImage(
			firstImageUrl,
			dataFolder,
			firstImageBuffer
		);

		if (!firstImageResult.success) {
			throw firstImageResult.error;
		}

		const isWebtoon = firstImageResult.isWebtoon;
		let imagesToWaitFor = 1;
		let cumulativeHeight = firstImageResult.height;

		if (isWebtoon) {
			// For webtoons, load more pages until cumulative height exceeds 3500 pixels
			let i = 1;
			const limit = pLimit(5); // Increase concurrency limit to 5

			const processNextImage = async (index) => {
				if (index >= imageUrls.length) return;

				const imageUrl = imageUrls[index];
				const result = await processImage(imageUrl, dataFolder);

				if (result.success) {
					cumulativeHeight += result.height || 0;
					imagesToWaitFor++;
				} else {
					console.error(
						`Failed to process image: ${imageUrl}`,
						result.error
					);
				}

				if (cumulativeHeight < 3500) {
					await processNextImage(index + 1);
				}
			};

			await limit(() => processNextImage(1));
		} else {
			// For non-webtoons, process the first 3 images
			imagesToWaitFor = Math.min(imageUrls.length, 2);
			const initialImageUrls = imageUrls.slice(1, imagesToWaitFor);

			const limit = pLimit(5); // Increase concurrency limit to 5

			await Promise.all(
				initialImageUrls.map((imageUrl) =>
					limit(() => processImage(imageUrl, dataFolder))
				)
			);
		}

		// Process remaining images asynchronously
		const remainingImageUrls = imageUrls.slice(imagesToWaitFor);
		if (remainingImageUrls.length > 0) {
			const limit = pLimit(5); // Use increased concurrency limit
			remainingImageUrls.forEach((imageUrl) => {
				limit(() => processImage(imageUrl, dataFolder)).catch((err) => {
					console.error(
						"Error processing image asynchronously:",
						err
					);
				});
			});
		}

		// Prepare the response with the intended image URLs
		const processedImages = imageUrls.map((imageUrl) =>
			getFinalURL(imageUrl)
		);

		// Send response back to client
		res.json({
			result: "ok",
			processedImages: processedImages,
			message: `Images are being processed. The first ${imagesToWaitFor} page(s) are ready.`,
		});
	} catch (err) {
		console.error("Error in route handler:", err);
		res.status(500).send("Internal Server Error");
	}
});

module.exports = router;
