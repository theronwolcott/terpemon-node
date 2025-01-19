# Terpémon Back-End (Node)

The back-end for **Terpémon**, a location-based augmented reality mobile game inspired by Pokémon GO and themed around the University of Maryland. This Node.js server integrates with MongoDB Atlas to manage player data, creature spawning and capture, and interactions with the game world.

## Features

- **Creature Management**: Dynamically generate, manage, and cache creatures based on player location and game rules.
- **Real-Time Location-Based Interactions**: Fetch nearby creatures and provide their data to players based on GPS.
- **Database Persistence**: Stores captured creatures and user activity using MongoDB collections.
- **API Endpoints**: RESTful API endpoints for game data requests and updates.
- **Data TTL**: Temporary hashes ensure game integrity by controlling creature spawns within 15-minute blocks, preventing users from catching the same creature more than once.

## Deterministic Creature Spawning

One of the most innovative features of the Terpémon back-end is its ability to deterministically spawn creatures anywhere on Earth, consistant across all users, without taking up database space. This system ensures that:

1. **Consistency Across Users and Time**: Creatures spawned at a specific location during a 15-minute block are the same for all users, ensuring a shared experience. Even if a user restarts the game, the spawn will be identical.
2. **Randomness with Predictability**: While the spawning is deterministic, it incorporates randomness through hashed values, creating unique experiences based on location, time, and species frequency.
3. **No Persistent Overhead**: The system avoids storing spawn data by dynamically calculating spawns in real-time using a combination of location, time, and species data.

### How It Works

- **15-Minute Time Blocks**: The server divides time into 15-minute intervals, using the current block's timestamp as a key.
- **Location Tiles**: The Earth's surface is divided into a grid of tiles (configurable size, e.g., 0.02° latitude/longitude). Each tile can host one or more creatures.
- **Frequency-Based Spawning**:
  - Each creature species has a `frequency` value (0.0 and up) representing the probability of its appearance in any tile.
  - A species with a frequency of `1.0` will always spawn, while one with `0.1` will spawn 10% of the time.
  - A frequency *over* `1.0` means more than one creature will appear on each and every tile
- **Hashing Mechanism**:
  - The system generates a hash value using the combination of time, unique tile ID, species ID, and iteration index.
  - This hash value is normalized to a float between 0 and 1, determining whether the creature spawns and assigning it a unique name from a predefined list.
  - A seperate randomized float is used for the latitude offset and longitude offset within the tile, so the creature's position in the tile is random every 15 minutes, but consistent for the entire 15 minutes for every user
  - The creature's name is also selected from this random (but consistent for 15 minutes for each tile) float, picked from an array of ~2,500 first names.
- **Dynamic Calculation**:
  - Spawns are all calculated dynamically on request, using the above inputs. This avoids the need for precomputing or persisting spawn data in the database.

### Example

Suppose a player is standing at latitude `38.9951` and longitude `-77.1244` during a specific 15-minute block:
1. The system rounds the coordinates to the nearest tile's southwest corner (e.g., `38.9900`, `-77.1300`).
2. For each species in the game, the system generates a hash based on:
   - Time: Current 15-minute block timestamp.
   - Tile ID: `"38.9900,-77.1300"`.
   - Species ID and iteration index.
3. The hash determines whether a species spawns in that tile and, if so, assigns its location within the tile.
4. The result is a list of creatures (with unique names) available in that location for the current time block.

### Production Deployment

The backend project is deployed on a free account on render.com, so it can take 30-40
seconds to boot up if it hasn't run in a while. I built a webpage to verify that it works 
so I can visualize the grid and spawning system: 
- **Terpemon near me**: https://terpemon-node.onrender.com/
- **Terpemon in D.C.**: https://terpemon-node.onrender.com/?lat=38.89530303519851&lng=-77.03831229990925
- **Terpemon in London**: https://terpemon-node.onrender.com/?lat=51.50295660380361&lng=-0.13010462129897424  

![Terpemon in London](images/Terpemon-London.png)

### Advantages of This System

- **Scalability**: By avoiding persistent storage of spawn data, the system scales effortlessly to cover the entire globe.
- **Fairness**: All players see the same creatures at a given time and location.
- **Adaptability**: The spawning algorithm can incorporate additional factors (e.g., weather, time of day) without altering its deterministic nature.

## Endpoints

### `POST /species/list`
Returns a list of all creature species available in the game. Stored locally as JSON, as it does not change during gameplay.

### `POST /creatures/list-captured`
Fetches all creatures captured by a user, retrieved from MongoDB Atlas based on **userId**.

#### Request Body:
```json
{
  "userId": "your-unique-user-id"
}
```

### `POST /creatures/catch`
Registers a newly caught creature for a user. Data is saved to two different collections in MongoDB. First, in the *Captured* collection, we save one record per user, indexed by **userId**, including an array of objects, each of which represents a caught creature (including the date/time of the capture). Second, in the *Hashes* collection, we save one record per userId *per 15-minute period* with an array of the hashes of every creature that user caught in that 15-minute window. We then use this data to remove any deterministically-spawned creatures for that user during the remainder of the window. But we use a TTL to have Mongo throw this data away after 15 minutes, so it doesn't pile up.

#### Request Body:
```json
{
  "id": 5,
  "hash": "abc123",
  "lat": 38.9951,
  "lng": -77.1244,
  "name": "Alphonse",
  "weather_code": 2,
  "userId": "your-unique-user-id"
}
```

### `POST /creatures/get-by-lat-lng`
Fetches nearby creatures based on player location. Uses the random (but determinisic) method described in more detail above. It also removes any creatures this user has already caught by querying Mongo.

#### Request Body:
```json
{
  "lat": 38.9951,
  "lng": -77.1244,
  "userId": "your-unique-user-id"
}
```

### `POST /weather`
Provides weather data for a given latitude and longitude, proxying an API from **open-meteo.com**. This is for future use.

#### Request Body:
```json
{
  "lat": 38.9951,
  "lng": -77.1244
}
```

## Species.json
This [static file](species.json) stores an array of all creature species in the game. A sample:
```json
[
    {
        "id": 8,                               // unique id of this species
        "name": "Charmob",                     // name of this species
        "description": "Charmob is a dazzling and chaotic spectacle...",
        "image": "images/species/8.png"        // relative path to species image
        "frequency": 0.15,                     // how often does this species appear per tile?
        "bestOf": 13,                          // how long is the rock-paper-scissors game?
        "winPct": 0.56,                        // likelihood the creature wins any one throw
        "stats": {                             // unique stats of this species
            "avuncularity": 8,
            "destrucity": 6,
            "panache": 9,
            "spiciness": 7
        }
    },
]
```

## Images
The web server also stores the static images of the game's creatures, which are loaded over HTTP by the mobile game

<table>
<tr>
<td align=center><image width=100 src="images/species/1.png"><br>1. Terpluff</td>
<td align=center><image width=100 src="images/species/2.png"><br>2. Cyclorchid</td>
<td align=center><image width=100 src="images/species/3.png"><br>3. Cheerpod</td>
<td align=center><image width=100 src="images/species/4.png"><br>4. Spectarion</td>
</tr>
<tr>
<td align=center><image width=100 src="images/species/5.png"><br>5. Monoclaw</td>
<td align=center><image width=100 src="images/species/6.png"><br>6. Spiracula</td>
<td align=center><image width=100 src="images/species/7.png"><br>7. Fuzzferno</td>
<td align=center><image width=100 src="images/species/8.png"><br>8. Charmob</td>
</tr>
<tr>
<td align=center><image width=100 src="images/species/9.png"><br>9. Quadroar</td>
<td align=center><image width=100 src="images/species/10.png"><br>10. Oculeia</td>
<td align=center><image width=100 src="images/species/11.png"><br>11. Splorch</td>
<td align=center><image width=100 src="images/species/12.png"><br>12. Bogloom</td>
</tr>
<tr>
<td align=center><image width=100 src="images/species/13.png"><br>13. Gryphflare</td>
<td align=center><image width=100 src="images/species/14.png"><br>14. Tanglurk</td>
<td align=center><image width=100 src="images/species/15.png"><br>15. Slymara</td>
<td align=center><image width=100 src="images/species/16.png"><br>16. Regalith</td>
</tr>
</table>

## Technologies Used

- **Node.js**: Handles server logic and routing.
- **Express**: Simplifies HTTP endpoint management.
- **MongoDB Atlas**: Stores user data, captured creatures, and hashed spawn data.
- **Mongoose**: Simplifies MongoDB schema management and queries.
- **Open-Meteo API**: Retrieves real-time weather data.
- **dotenv**: Manages environment variables for secure configuration.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/theronwolcott/terpemon-node.git
   ```
2. Navigate to the project directory:
   ```bash
   cd terpemon-node
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Configure environment variables in a `.env` file:
   ```env
   MONGO_DB_USERNAME=your_username
   MONGO_DB_PASSWORD=your_password
   MONGO_DB_NAME=your_database_name
   PORT=3000
   ```
5. Start the server:
   ```bash
   node index.js
   ```

## Folder Structure

- `index.js`: Entry point for the server.
- `species.json`: Data for all creature species.
- `names.json`: List of unique names for creatures.
- `images/`: Static assets for creature imagery.

## Future Improvements

- Add OAuth for user authentication.
- Enhance caching for frequent queries.
- Support for multiplayer interactions and trading.

## Related Repositories

- [Terpémon Mobile App](https://github.com/theronwolcott/terpemon-flutter): Front-end project for the mobile app.

## Contact

**Theron Wolcott**  
📧 theronwolcott@gmail.com  
`
