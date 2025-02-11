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

			// Download and process the first image to perform the check
			const firstImageFilename = imageFilenames[0];
			const firstImageResult = await processImage(
				originalBaseUrl,
				chapterHash,
				firstImageFilename,
				chapterFolder,
				null, // No imageBuffer provided
				true // Indicate that we need metadata returned
			);

			if (!firstImageResult.success) {
				throw new Error(
					`Failed to process the first image: ${firstImageResult.error}`
				);
			}

			const isWebtoon = firstImageResult.isWebtoon;
			let imagesToWaitFor = 1;
			let cumulativeHeight = firstImageResult.height;

			if (isWebtoon) {
				const heightThreshold = 3500; // Height threshold in pixels

				if (cumulativeHeight >= heightThreshold) {
					// First image height exceeds threshold; only process this image
					//console.log(
					//	"First image height exceeds threshold. Only processing one image."
					//);
				} else {
					// Load more images until cumulative height exceeds threshold
					const limit = pLimit(5); // Increase concurrency limit to 5
					let i = 1; // Start from the second image

					while (
						cumulativeHeight < heightThreshold &&
						i < imageFilenames.length
					) {
						const imageFilename = imageFilenames[i];
						const imageResult = await limit(() =>
							processImage(
								originalBaseUrl,
								chapterHash,
								imageFilename,
								chapterFolder,
								null,
								true // We need metadata to get the height
							)
						);

						if (!imageResult.success) {
							console.error(
								`Error processing image ${imageFilename}:`,
								imageResult.error
							);
						} else {
							cumulativeHeight += imageResult.height;
							imagesToWaitFor++;
						}
						i++;
					}
				}
			} else {
				// For non-webtoons, process the first 3 images
				imagesToWaitFor = Math.min(imageFilenames.length, 2);
				const initialImageFilenames = imageFilenames.slice(
					1,
					imagesToWaitFor
				);

				const limit = pLimit(5); // Increase concurrency limit to 5

				await Promise.all(
					initialImageFilenames.map((imageFilename) =>
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
			}

			// Process the remaining images asynchronously
			const remainingImageFilenames =
				imageFilenames.slice(imagesToWaitFor);
			if (remainingImageFilenames.length > 0) {
				const limit = pLimit(5); // Increase concurrency limit to 5
				remainingImageFilenames.forEach((imageFilename) => {
					limit(() =>
						processImage(
							originalBaseUrl,
							chapterHash,
							imageFilename,
							chapterFolder
						).catch((err) => {
							console.error(
								"Error processing image asynchronously:",
								err
							);
						})
					);
				});
			}

			// Replace baseUrl in response data
			const baseUrl = process.env.SITE;
			response.data.baseUrl = baseUrl;

			// Send response back to client
			res.json({
				...response.data,
				message: `Images are being processed. The first ${imagesToWaitFor} page(s) are ready.`,
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

// Function to process images
async function processImage(
	baseUrl,
	chapterHash,
	imageFilename,
	chapterFolder,
	imageBuffer = null,
	returnMetadata = false
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

			// Download the image into a buffer if not provided
			if (!imageBuffer) {
				const response = await axios.get(imageUrl, {
					headers: {
						referer: `${baseUrl}/`,
					},
					responseType: "arraybuffer",
				});

				imageBuffer = Buffer.from(response.data);
			}

			// Get image metadata
			const metadata = await sharp(imageBuffer).metadata();

			// Calculate the aspect ratio to determine if it's a webtoon
			const aspectRatio = metadata.height / metadata.width;
			const isWebtoon = aspectRatio > 1.6; // Adjust threshold if needed

			// Prepare the Sharp transformer
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

			// Save the processed image to disk
			await transformer.toFile(imagePath);

			const result = { success: true, filename: imageFilename };

			if (returnMetadata) {
				result.isWebtoon = isWebtoon;
				result.height = metadata.height;
			}

			return result;
		} catch (err) {
			return { success: false, filename: imageFilename, error: err };
		}
	}
}

module.exports = router;
