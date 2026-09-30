/* ---------- sample shelf ----------
   A made-up owner's shelf of well-known games, for trying the app without a BGG account
   (and before the BGG helper is set up). Player counts, times, categories and mechanics
   follow BGG's naming; weights, ratings, plays and player-count votes are approximate.
   Row: [BGG id, name, year, min players, max players, minutes, weight, BGG types,
         categories, mechanics, best counts, recommended counts, owner rating, plays, families]
   BGG types: s strategy, f family, p party, t thematic, a abstract, w wargame, c customizable, k kids */
const SAMPLE_ROWS = [
  [13, 'CATAN', 1995, 3, 4, 120, 2.3, 'fs', 'Economic|Negotiation', 'Dice Rolling|Trading|Network and Route Building|Modular Board', '4', '3,4', 7, 12],
  [822, 'Carcassonne', 2000, 2, 5, 45, 1.9, 'f', 'City Building|Medieval|Territory Building', 'Tile Placement|Area Majority / Influence', '2', '2,3,4', 7, 20],
  [9209, 'Ticket to Ride', 2004, 2, 5, 60, 1.8, 'f', 'Trains|Travel', 'Set Collection|Network and Route Building|Hand Management|Open Drafting', '4', '2,3,4,5', 8, 15],
  [30549, 'Pandemic', 2008, 2, 4, 45, 2.4, 'fs', 'Medical', 'Cooperative Game|Hand Management|Set Collection|Point to Point Movement|Variable Player Powers', '4', '2,3,4', 8, 9],
  [178900, 'Codenames', 2015, 2, 8, 15, 1.3, 'p', 'Card Game|Deduction|Party Game|Spies/Secret Agents|Word Game', 'Communication Limits|Team-Based Game', '6,8', '4,5,6,7,8', 8, 25],
  [68448, '7 Wonders', 2010, 2, 7, 30, 2.3, 's', 'Ancient|Card Game|City Building|Civilization', 'Closed Drafting|Set Collection|Simultaneous Action Selection|Variable Player Powers', '4,5', '3,4,5,6,7', 7, 6],
  [36218, 'Dominion', 2008, 2, 4, 30, 2.4, 'sf', 'Card Game|Medieval', 'Deck, Bag, and Pool Building|Hand Management', '2,3', '2,3,4', 8, 30],
  [230802, 'Azul', 2017, 2, 4, 45, 1.8, 'af', 'Abstract Strategy|Renaissance', 'Tile Placement|Open Drafting|Pattern Building', '2', '2,3,4', 8, 18],
  [148228, 'Splendor', 2014, 2, 4, 30, 1.8, 'sf', 'Card Game|Economic|Renaissance', 'Set Collection|Open Drafting', '2,3', '2,3,4', 7, 10],
  [266192, 'Wingspan', 2019, 1, 5, 70, 2.4, 's', 'Animals|Card Game|Educational', 'Dice Rolling|Hand Management|Set Collection|End Game Bonuses', '3', '1,2,3,4,5', 9, 14],
  [167791, 'Terraforming Mars', 2016, 1, 5, 120, 3.3, 's', 'Economic|Environmental|Industry / Manufacturing|Science Fiction|Space Exploration|Territory Building', 'Hand Management|Tile Placement|Variable Player Powers|End Game Bonuses', '3', '1,2,3,4', 9, 8],
  [174430, 'Gloomhaven', 2017, 1, 4, 120, 3.9, 'st', 'Adventure|Exploration|Fantasy|Fighting|Miniatures', 'Cooperative Game|Hand Management|Legacy Game|Scenario / Mission / Campaign Game|Grid Movement|Variable Player Powers', '2,3', '1,2,3,4', 9, 3],
  [128882, 'The Resistance: Avalon', 2012, 5, 10, 30, 1.8, 'p', 'Bluffing|Card Game|Deduction|Fantasy|Medieval|Negotiation|Party Game|Spies/Secret Agents', 'Hidden Roles|Team-Based Game|Voting|Traitor Game', '7,8,9,10', '5,6,7,8,9,10', 8, 11],
  [240980, 'Blood on the Clocktower', 2022, 5, 20, 120, 2.8, 'p', 'Bluffing|Deduction|Horror|Murder/Mystery|Party Game', 'Hidden Roles|Player Elimination|Voting|Traitor Game|Variable Player Powers', '10,11,12', '7,8,9,10,11,12,13,14,15', 0, 0],
  [162886, 'Spirit Island', 2017, 1, 4, 120, 4.1, 'st', 'Environmental|Fantasy|Territory Building', 'Cooperative Game|Area Majority / Influence|Hand Management|Variable Player Powers|Simultaneous Action Selection', '2', '1,2,3,4', 9, 7],
  [224517, 'Brass: Birmingham', 2018, 2, 4, 120, 3.9, 's', 'Economic|Industry / Manufacturing|Transportation', 'Hand Management|Loans|Network and Route Building|Market', '3,4', '2,3,4', 9, 2],
  [169786, 'Scythe', 2016, 1, 5, 115, 3.4, 's', 'Economic|Fighting|Science Fiction|Territory Building', 'Area Majority / Influence|Grid Movement|Variable Player Powers|Contracts', '4', '2,3,4,5', 8, 3],
  [31260, 'Agricola', 2007, 1, 5, 150, 3.6, 's', 'Animals|Economic|Farming', 'Worker Placement|Hand Management|Enclosure|Variable Set-up', '3,4', '1,2,3,4,5', 8, 0],
  [129622, 'Love Letter', 2012, 2, 4, 20, 1.2, 'f', 'Card Game|Deduction|Renaissance', 'Hand Management|Player Elimination', '4', '3,4', 7, 5],
  [133473, 'Sushi Go!', 2013, 2, 5, 15, 1.2, 'f', 'Card Game', 'Closed Drafting|Set Collection|Hand Management', '4,5', '2,3,4,5', 7, 8],
  [70323, 'King of Tokyo', 2011, 2, 6, 30, 1.5, 'f', 'Dice|Fighting|Movies / TV / Radio theme|Science Fiction', 'Dice Rolling|Player Elimination|Push Your Luck|King of the Hill', '4,5', '3,4,5,6', 7, 6],
  [39856, 'Dixit', 2008, 3, 6, 30, 1.2, 'fp', 'Card Game|Humor|Party Game', 'Storytelling|Voting|Hand Management', '6', '4,5,6', 7, 7],
  [262543, 'Wavelength', 2019, 2, 12, 45, 1.1, 'p', 'Party Game', 'Team-Based Game|Communication Limits', '6,7,8', '4,5,6,7,8,9,10,11,12', 8, 5],
  [254640, 'Just One', 2018, 3, 7, 20, 1.1, 'p', 'Party Game|Word Game', 'Cooperative Game|Communication Limits|Simultaneous Action Selection', '5,6,7', '4,5,6,7', 8, 9],
  [295947, 'Cascadia', 2021, 1, 4, 45, 1.8, 'f', 'Animals|Environmental|Puzzle', 'Tile Placement|Open Drafting|Pattern Building|End Game Bonuses', '2,3', '1,2,3,4', 8, 11],
  [199792, 'Everdell', 2018, 1, 4, 80, 2.8, 's', 'Animals|City Building|Fantasy', 'Worker Placement|Hand Management|Set Collection', '2,3', '1,2,3,4', 8, 4],
  [237182, 'Root', 2018, 2, 4, 90, 3.7, 'st', 'Animals|Fantasy|Fighting|Territory Building|Wargame', 'Area Majority / Influence|Variable Player Powers|Dice Rolling|Hand Management', '4', '3,4', 8, 2],
  [284083, 'The Crew: The Quest for Planet Nine', 2019, 2, 5, 20, 2.0, 'f', 'Card Game|Science Fiction|Space Exploration', 'Cooperative Game|Trick-taking|Communication Limits|Scenario / Mission / Campaign Game', '4', '3,4,5', 8, 22],
  [98778, 'Hanabi', 2010, 2, 5, 25, 1.7, 'f', 'Card Game|Deduction|Memory', 'Cooperative Game|Communication Limits|Hand Management', '3,4', '2,3,4,5', 7, 6],
  [84876, 'The Castles of Burgundy', 2011, 1, 4, 90, 3.0, 's', 'Dice|Medieval|Territory Building', 'Dice Rolling|Tile Placement|Set Collection|Open Drafting', '2', '2,3', 9, 13],
  [163412, 'Patchwork', 2014, 2, 2, 30, 1.6, 'af', 'Abstract Strategy|Economic|Puzzle', 'Tile Placement|Pattern Building|Time Track', '2', '2', 8, 16],
  [54043, 'Jaipur', 2009, 2, 2, 30, 1.5, 'f', 'Animals|Card Game|Economic', 'Set Collection|Hand Management|Open Drafting|Trading', '2', '2', 8, 21],
  [2655, 'Hive', 2001, 2, 2, 20, 2.3, 'a', 'Abstract Strategy|Animals', 'Enclosure|Hexagon Grid', '2', '2', 7, 10],
  [194655, 'Santorini', 2016, 2, 4, 20, 1.8, 'af', 'Abstract Strategy|City Building|Mythology', 'Grid Movement|Variable Player Powers', '2', '2', 7, 5],
  [521, 'Crokinole', 1876, 2, 4, 30, 1.3, 'a', 'Action / Dexterity|Sports', 'Flicking|Team-Based Game', '2,4', '2,4', 9, 40],
  [366013, 'Heat: Pedal to the Metal', 2022, 1, 6, 60, 2.2, 'fs', 'Racing|Sports', 'Hand Management|Push Your Luck|Simultaneous Action Selection|Race', '5,6', '2,3,4,5,6', 9, 6],
  [244521, 'The Quacks of Quedlinburg', 2018, 2, 4, 45, 1.9, 'f', 'Fantasy|Medical', 'Deck, Bag, and Pool Building|Push Your Luck|Catch the Leader', '4', '2,3,4', 8, 9],
  [41, 'Can’t Stop', 1980, 2, 4, 30, 1.2, 'f', 'Dice', 'Dice Rolling|Push Your Luck', '2,3', '2,3,4', 7, 12],
  [263918, 'Cartographers', 2019, 1, 100, 45, 1.9, 'f', 'Card Game|Fantasy|Territory Building', 'Paper-and-Pencil|Pattern Building|End Game Bonuses', '2,3,4', '1,2,3,4,5,6,7,8', 8, 7, 'Mechanism: Flip-and-Write'],
  [225694, 'Decrypto', 2018, 3, 8, 45, 1.8, 'p', 'Card Game|Deduction|Party Game|Spies/Secret Agents|Word Game', 'Team-Based Game|Communication Limits', '6,8', '4,5,6,7,8', 8, 3],
  [131357, 'Coup', 2012, 2, 6, 15, 1.4, 'p', 'Bluffing|Card Game|Deduction|Political|Science Fiction', 'Player Elimination|Take That|Variable Player Powers', '5', '3,4,5,6', 7, 8],
  [92415, 'Skull', 2011, 3, 6, 45, 1.1, 'p', 'Bluffing|Party Game', 'Betting and Bluffing|Push Your Luck|Player Elimination', '4,5,6', '3,4,5,6', 8, 4],
  [181304, 'Mysterium', 2015, 2, 7, 42, 1.9, 'fp', 'Deduction|Horror|Murder/Mystery|Party Game', 'Cooperative Game|Communication Limits|Hand Management', '5,6', '3,4,5,6,7', 7, 3],
  [316554, 'Dune: Imperium', 2020, 1, 4, 120, 3.0, 's', 'Card Game|Novel-based|Political|Science Fiction', 'Deck, Bag, and Pool Building|Worker Placement|Hand Management|Variable Player Powers', '3,4', '1,2,3,4', 9, 5],
  [205637, 'Arkham Horror: The Card Game', 2016, 1, 2, 120, 3.5, 'ct', 'Adventure|Card Game|Fantasy|Horror|Murder/Mystery|Novel-based', 'Cooperative Game|Deck Construction|Scenario / Mission / Campaign Game|Variable Player Powers', '1,2', '1,2', 9, 12],
  [150376, 'Dead of Winter: A Crossroads Game', 2014, 2, 5, 120, 3.2, 't', 'Bluffing|Horror|Zombies|Fighting', 'Cooperative Game|Traitor Game|Dice Rolling|Hand Management|Voting', '4,5', '3,4,5', 7, 2],
  [161936, 'Pandemic Legacy: Season 1', 2015, 2, 4, 60, 2.8, 'st', 'Environmental|Medical', 'Cooperative Game|Legacy Game|Hand Management|Point to Point Movement|Set Collection', '4', '2,3,4', 9, 12],
  [204583, 'Kingdomino', 2016, 2, 4, 15, 1.2, 'f', 'Animals|Medieval|Territory Building', 'Tile Placement|Pattern Building|Open Drafting', '2,4', '2,3,4', 7, 9],
  [46213, 'Telestrations', 2009, 4, 8, 30, 1.0, 'p', 'Humor|Party Game', 'Line Drawing|Paper-and-Pencil|Simultaneous Action Selection', '6,7,8', '5,6,7,8', 7, 3],
  [153938, 'Camel Up', 2014, 2, 8, 30, 1.4, 'fp', 'Animals|Racing|Sports', 'Betting and Bluffing|Dice Rolling|Race', '5,6', '3,4,5,6,7,8', 7, 4],
  [31481, 'Galaxy Trucker', 2007, 2, 4, 60, 2.3, 'f', 'Science Fiction|Space Exploration|Real-time', 'Real-Time|Tile Placement|Dice Rolling', '4', '2,3,4', 7, 3],
  [171131, 'Captain Sonar', 2016, 2, 8, 45, 2.2, 'p', 'Deduction|Nautical|Real-time|Wargame', 'Real-Time|Team-Based Game|Grid Movement|Simultaneous Action Selection', '8', '6,7,8', 7, 0],
  [157969, 'Sheriff of Nottingham', 2014, 3, 5, 60, 1.6, 'fp', 'Bluffing|Card Game|Medieval|Negotiation|Party Game', 'Betting and Bluffing|Hand Management|Role Playing|Set Collection', '5', '3,4,5', 7, 2],
  [12333, 'Twilight Struggle', 2005, 2, 2, 180, 3.6, 'sw', 'Modern Warfare|Political|Wargame', 'Campaign / Battle Card Driven|Area Majority / Influence|Dice Rolling|Hand Management', '2', '2', 8, 0],
  [201808, 'Clank!: A Deck-Building Adventure', 2016, 2, 4, 60, 2.2, 'st', 'Adventure|Card Game|Exploration|Fantasy', 'Deck, Bag, and Pool Building|Push Your Luck|Point to Point Movement', '4', '2,3,4', 8, 5],
  [110327, 'Lords of Waterdeep', 2012, 2, 5, 120, 2.5, 's', 'City Building|Fantasy|Medieval', 'Worker Placement|Set Collection|Contracts|Hand Management', '4', '2,3,4,5', 7, 6],
  [183394, 'Viticulture Essential Edition', 2015, 1, 6, 90, 2.9, 's', 'Economic|Farming', 'Worker Placement|Hand Management|Variable Player Powers', '4', '2,3,4,5,6', 8, 3],
  [40692, 'Small World', 2009, 2, 5, 80, 2.4, 'f', 'Fantasy|Fighting|Territory Building', 'Area Majority / Influence|Dice Rolling|Variable Player Powers', '4', '3,4,5', 7, 4],
  [39463, 'Cosmic Encounter', 2008, 3, 5, 120, 2.6, 'st', 'Bluffing|Negotiation|Science Fiction|Space Exploration', 'Negotiation|Hand Management|Variable Player Powers|Trading', '5', '4,5', 8, 2],
  [215, 'Tichu', 1991, 3, 6, 60, 2.3, 'f', 'Card Game', 'Trick-taking|Team-Based Game|Hand Management', '4', '4', 8, 0],
  [156546, 'Monikers', 2015, 4, 20, 60, 1.1, 'p', 'Card Game|Humor|Party Game', 'Acting|Team-Based Game', '8', '6,7,8,9,10', 9, 2],
  [171, 'Chess', 1475, 2, 2, 60, 3.7, 'a', 'Abstract Strategy', 'Grid Movement|Pattern Recognition', '2', '2', 7, 50],
  [10630, 'Memoir ’44', 2004, 2, 8, 60, 2.2, 'w', 'Wargame|World War II', 'Dice Rolling|Hand Management|Hexagon Grid|Scenario / Mission / Campaign Game', '2', '2', 7, 3],
  [463, 'Magic: The Gathering', 1993, 2, 4, 20, 3.2, 'c', 'Card Game|Collectible Components|Fantasy|Fighting', 'Deck Construction|Hand Management|Take That', '2', '2,4', 8, 30]
];
const SAMPLE_SUB = {s: 'strategy', f: 'family', p: 'party', t: 'thematic', a: 'abstract', w: 'war', c: 'cgs', k: 'kids'};
function sampleShelf() {
  return SAMPLE_ROWS.map(r => {
    const [id, n, y, p0, p1, t, w, sub, c, m, best, rec, ur, pl, f] = r;
    const B = best.split(',').map(Number), RC = rec.split(',').map(Number), np = {};
    for (let k = Math.max(1, p0); k <= Math.min(p1, 12); k++) np[k] = B.includes(k) ? [60, 35, 5] : RC.includes(k) ? [15, 60, 25] : [3, 22, 75];
    return {id, n, y, im: '', p0, p1, t, w, ur, ba: ur ? Math.round((ur - 0.4 + (id % 7) / 10) * 100) / 100 : 7.2, pl,
      sub: sub.split('').map(ch => SAMPLE_SUB[ch]).filter(Boolean), c: c.split('|'), m: m.split('|'), f: f ? f.split('|') : [], np, det: 1};
  });
}
