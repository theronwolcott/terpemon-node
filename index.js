require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const ejs = require("ejs");
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");
const { get } = require("http");
// const { OpenAI } = require("openai");
const args = process.argv;
const port = process.env.PORT || args[2] || 3000;
const app = express();
const path = require("path");
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "ejs"));
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { writeFile } = require("fs/promises");
const fs = require("fs");

// app.use(cookieParser());
const species = require("./species.json");
const names = require("./names.json");

const mongourl = `mongodb+srv://${process.env.MONGO_DB_USERNAME}:${process.env.MONGO_DB_PASSWORD}@cluster0.iw8z5.mongodb.net/${process.env.MONGO_DB_NAME}?retryWrites=true&w=majority`;
mongoose
  .connect(mongourl)
  .then(() => console.log("connected"))
  .catch((error) => console.log("did not connect: " + error));

// ONLY store the creatures people actually catch
const capturedSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  captured: [
    {
      timestamp: { type: Date, default: Date.now },
      weather_code: { type: Number },
      creature: {
        id: { type: Number, required: true },
        hash: { type: String, required: true },
        name: { type: String },
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
      },
    },
  ],
});
const Captured = mongoose.model("Captured", capturedSchema, "Captured");

const hashSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  time: { type: Number, required: true },
  hashes: [{ type: String }],
  createdAt: { type: Date, default: Date.now }, // need for TTL
});
// Create a compound index on userId and time, enforcing uniqueness
hashSchema.index({ userId: 1, time: 1 }, { unique: true });

// Create a TTL index on createdAt, documents will be deleted after 15 minutes
hashSchema.index({ createdAt: 1 }, { expireAfterSeconds: 900 }); // 900 seconds = 15 minutes

const Hashes = mongoose.model("Hashes", hashSchema, "Hashes");

async function getHashesForUser(userId, time) {
  try {
    // Query MongoDB to find the document by userId and time
    const result = await Hashes.findOne({ userId, time });

    // If a document is found, return the hashes array, otherwise return an empty array
    return result ? result.hashes : [];
  } catch (error) {
    console.error("Error fetching hashes:", error);
    return [];
  }
}

async function getWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FNew_York`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    data.daily = data.daily.time.map((_, index) => {
      return Object.fromEntries(
        Object.keys(data.daily).map((key) => [key, data.daily[key][index]])
      );
    });
    data.current.weather =
      wmo[data.current.weather_code.toString()][
        data.current.is_day ? "day" : "night"
      ];
    data.daily.forEach((day) => {
      day.weather = wmo[day.weather_code.toString()]["day"];
    });
    return data;
  } catch (error) {
    console.error("Couldn't fetch weather", error);
  }
}

// Now apply the JSON parser middleware
app.use(express.json());

app.use("/images", express.static(path.join(__dirname, "images")));

app.post("/species/list", async (req, res) => {
  // console.log("list: " + new Date());
  // console.log(species);
  res.json(species);
});

app.post("/creatures/list-captured", async (req, res) => {
  let { userId } = req.body;
  // console.log("list-captured: " + new Date());
  // console.log("userId: " + userId);
  let result = await Captured.findOne({ userId });
  if (result == null) result = [];
  else result = result.captured;
  // console.log(result);
  res.json(result);
  // res.json([{
  //     id: 5,
  //     hash: '0adbe313fed33cefef30b3e2ca451b65a40b83ff',
  //     name: 'Andie',
  //     lat: 38.99510028878578,
  //     lng: -77.12445764079328
  // },
  // {
  //     id: 14,
  //     hash: '0250b5b034be8bf73b6d29ed333506b63e086bb4',
  //     name: 'Adlai',
  //     lat: 38.98845124727777,
  //     lng: -77.12136740236109
  // }]);
});

app.post("/creatures/catch", async (req, res) => {
  let { id, hash, lat, lng, name, weather_code, userId } = req.body;
  // for testing
  if (hash.startsWith("abc123")) res.status(200).end();
  // Make sure we don't show on the map again
  const time = getCurrent15MinuteBlock();
  Hashes.findOneAndUpdate(
    { userId, time }, // Search for document by userId and time
    { $addToSet: { hashes: hash } }, // Add newHash to the hashes array (only if it doesn't already exist)
    { upsert: true, new: true } // upsert: true creates a new document if not found, new: true returns the updated document
  ).catch((error) =>
    console.error("Couldn't save Hashes.findOneAndUpdate", error)
  );
  // Actually add to caught list
  Captured.findOneAndUpdate(
    { userId },
    {
      $push: {
        captured: {
          $each: [{ weather_code, creature: { id, hash, lat, lng, name } }],
        },
      },
    },
    {
      upsert: true,
      new: true,
    }
  ).catch((error) =>
    console.error("Couldn't save Captured.findOneAndUpdate", error)
  );
  res.status(200).end();
});

async function getHashString(str) {
  // Encode the string as a Uint8Array
  const encoder = new TextEncoder();
  const data = encoder.encode(str);

  // Compute the SHA-1 hash, tiny difference here = big difference in output "avalanche effect"
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);

  // Convert the hash to a hexadecimal string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return hashHex;
}
async function hashStringToFloat(str) {
  // Get the hash string
  const hashHex = await getHashString(str);

  // Convert the first 8 characters of the hash to a number
  const hashInt = parseInt(hashHex.slice(1, 9), 16);

  // Normalize the hash to a float between 0 and 1
  return hashInt / 0xffffffff;
}

function getCurrent15MinuteBlock() {
  const now = new Date();
  const roundedMinutes = Math.floor(now.getMinutes() / 15) * 15; // Round down to the nearest 15 minutes
  now.setMinutes(roundedMinutes, 0, 0); // Set minutes, seconds, and milliseconds to the rounded value
  return now.getTime(); // Return timestamp in milliseconds
}
async function calcLatLng(time, id, iteration, tile = "", latLng = "") {
  const hash = await hashStringToFloat(
    time.toString() + id + iteration + tile + latLng
  );
  return hash;
}
// Round latlng for a tile to bottom left corner
function roundDownToNearest(value, step, precision = 2) {
  const result = Math.floor(value / step) * step;
  return parseFloat(result.toFixed(precision));
}

async function getTileBounds(
  lat,
  lng,
  xOffset = 0,
  yOffset = 0,
  tileSize = 0.02
) {
  // move lat/lng to SW corner of center "tile"
  lat = roundDownToNearest(lat, tileSize);
  lng = roundDownToNearest(lng, tileSize);

  // console.log(xOffset + ", " + yOffset + ", " + lat + ", " + lng);

  let minlat = lat - yOffset * tileSize;
  let minlng = lng - xOffset * tileSize;

  return {
    lat: {
      min: minlat,
      max: lat + (yOffset + 1) * tileSize,
    },
    lng: {
      min: minlng,
      max: lng + (xOffset + 1) * tileSize,
    },
    tileSize: tileSize,
    id: minlat.toString() + "," + minlng.toString(),
  };
}
app.post("/creatures/get-by-lat-lng", async (req, res) => {
  let { lat, lng, userId } = req.body;
  // console.log("get-by-lat-lng: " + new Date() + " " + lat + " " + lng);

  const time = getCurrent15MinuteBlock();

  const caughtHashes = await getHashesForUser(userId, time);

  let response = [];
  // loop over 3x3 grid of "tiles"
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      let bounds = await getTileBounds(lat, lng, x, y);
      // console.log(bounds);
      for (let sp of species) {
        if (sp.frequency >= 1) {
          // Creatures that always spawn
          for (i = 0; i < sp.frequency; i++) {
            let hash = await getHashString(
              // Time, species id and bounds make it unique,
              // i makes sure that two of same species have different hashes
              time + sp.id + bounds.id + i.toString()
            );
            if (caughtHashes.includes(hash)) continue;
            let float = parseInt(hash.slice(1, 9), 16) / 0xffffffff;
            let name = names[Math.floor(float * names.length)];
            // Randomize within tile
            response.push({
              id: sp.id,
              hash: hash,
              name: name,
              lat:
                bounds.lat.min +
                (await calcLatLng(time, sp.id, i, bounds.id, "lat")) *
                  bounds.tileSize,
              lng:
                bounds.lng.min +
                (await calcLatLng(time, sp.id, i, bounds.id, "lng")) *
                  bounds.tileSize,
            });
          }
        } else {
          // Creatures that may or may not spawn
          let hash = await getHashString(time + sp.id + bounds.id + "0");
          if (caughtHashes.includes(hash)) continue;
          // turn hash into a float so it's appearance (or not) is the same for
          // this creature for the entire 15 min block
          let float = parseInt(hash.slice(1, 9), 16) / 0xffffffff;
          let name = names[Math.floor(float * names.length)];
          if (float <= sp.frequency) {
            response.push({
              id: sp.id,
              hash: hash,
              name: name,
              lat:
                bounds.lat.min +
                (await calcLatLng(time, sp.id, 0, bounds.id, "lat")) *
                  bounds.tileSize,
              lng:
                bounds.lng.min +
                (await calcLatLng(time, sp.id, 0, bounds.id, "lng")) *
                  bounds.tileSize,
            });
          }
        }
      }
    }
  }
  response.push({
    id: 7,
    hash: "abc123",
    name: "Erling",
    lat: 39.012483930361064,
    lng: -77.11093870527134,
  });
  response.push({
    id: 5,
    hash: "abc12345",
    name: "Kevin",
    lat: 39.01313951523564,
    lng: -77.11090123379418,
  });
  response.push({
    id: 1,
    hash: "abc123456",
    name: "Z",
    lat: 38.98641,
    lng: -77.09559,
  });
  response.push({
    id: 6,
    hash: "abc1234567",
    name: "Test",
    lat: 38.98221,
    lng: -77.0932,
  });

  res.json(response);
});

app.post("/weather", async (req, res) => {
  let { lat, lng } = req.body;
  const weather = await getWeather(lat, lng);
  res.json(weather);
});

// Test map
app.get("/", (req, res) => {
  // Check for optional lat and lng query parameters
  const { lat, lng } = req.query;

  // If lat and lng are provided, pass them to EJS. Otherwise, fall back to geolocation.
  if (lat && lng) {
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    res.render("map", {
      lat: userLat,
      lng: userLng,
    });
  } else {
    // Fall back to geolocation
    res.render("map", {
      lat: 0, // Default to 0,0 if no query params or geolocation
      lng: 0,
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
