// Builds BoardGameGeek-style XML (collection + thing) from the sample shelf, for tests.
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../src/sample.js', import.meta.url), 'utf8');
const box = {};
vm.runInNewContext(src + '\nthis.SAMPLE_ROWS = SAMPLE_ROWS; this.sampleShelf = sampleShelf;', box);
export const SAMPLE_ROWS = box.SAMPLE_ROWS;
export const sampleShelf = box.sampleShelf;

const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SUBS = {strategy: [5497, 'strategygames', 'Strategy Game Rank'], family: [5499, 'familygames', 'Family Game Rank'],
  party: [5498, 'partygames', 'Party Game Rank'], thematic: [5496, 'thematic', 'Thematic Rank'], abstract: [4666, 'abstracts', 'Abstract Game Rank'],
  war: [4664, 'wargames', 'War Game Rank'], cgs: [4667, 'cgs', 'Customizable Rank'], kids: [4665, 'childrensgames', "Children's Game Rank"]};
export const thumb = id => `https://cf.geekdo-images.com/Hash${id}Abc__thumb/img/Sig${id}xyz=/fit-in/200x150/filters:strip_icc()/pic${id}.jpg`;
function ranks(g, notRanked) {
  return `<ranks>
          <rank type="subtype" id="1" name="boardgame" friendlyname="Board Game Rank" value="${notRanked ? 'Not Ranked' : 100 + (g.id % 900)}" bayesaverage="${notRanked ? 'Not Ranked' : '6.9'}"/>
` + g.sub.map(s => `          <rank type="family" id="${SUBS[s][0]}" name="${SUBS[s][1]}" friendlyname="${x(SUBS[s][2])}" value="${notRanked ? 'Not Ranked' : 10 + (g.id % 300)}" bayesaverage="6.8"/>`).join('\n') + `
        </ranks>`;
}
/* opts: {ids, rating: {id: 'N/A'|number}, notRanked: [ids], extra: string of raw item xml} */
export function collectionXML(opts) {
  const games = sampleShelf().filter(g => opts.ids.includes(g.id));
  const items = games.map(g => {
    const rating = opts.rating && g.id in opts.rating ? opts.rating[g.id] : g.ur;
    return `  <item objecttype="thing" objectid="${g.id}" subtype="boardgame" collid="${900000 + g.id}">
    <name sortindex="1">${x(g.n)}</name>
    <yearpublished>${g.y}</yearpublished>
    <image>https://cf.geekdo-images.com/Hash${g.id}Abc__original/img/Orig${g.id}=/0x0/filters:format(jpeg)/pic${g.id}.jpg</image>
    <thumbnail>${x(thumb(g.id))}</thumbnail>
    <stats minplayers="${g.p0}" maxplayers="${g.p1}" minplaytime="${Math.round(g.t / 2)}" maxplaytime="${g.t}" playingtime="${g.t}" numowned="12345">
      <rating value="${rating || 'N/A'}">
        <usersrated value="4321"/>
        <average value="${g.ba}"/>
        <bayesaverage value="6.9"/>
        <stddev value="1.3"/>
        <median value="0"/>
        ${ranks(g, (opts.notRanked || []).includes(g.id))}
      </rating>
    </stats>
    <status own="1" prevowned="0" fortrade="0" want="0" wanttoplay="0" wanttobuy="0" wishlist="0" preordered="0" lastmodified="2025-11-02 09:12:44"/>
    <numplays>${g.pl}</numplays>
  </item>`;
  });
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<items totalitems="${items.length}" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse" pubdate="Wed, 30 Sep 2026 11:00:00 +0000">
${items.join('\n')}
${opts.extra || ''}
</items>`;
}
let linkId = 1000;
export function thingXML(ids) {
  const byId = Object.fromEntries(sampleShelf().map(g => [g.id, g]));
  const items = ids.filter(id => byId[id]).map(id => {
    const g = byId[id];
    const counts = Object.keys(g.np).map(Number).sort((a, b) => a - b);
    const poll = counts.map(n => `      <results numplayers="${n}">
        <result value="Best" numvotes="${g.np[n][0]}"/>
        <result value="Recommended" numvotes="${g.np[n][1]}"/>
        <result value="Not Recommended" numvotes="${g.np[n][2]}"/>
      </results>`).join('\n') + (counts.length ? `
      <results numplayers="${counts[counts.length - 1]}+">
        <result value="Best" numvotes="0"/><result value="Recommended" numvotes="1"/><result value="Not Recommended" numvotes="40"/>
      </results>` : '');
    const links = [
      ...g.c.map(v => `    <link type="boardgamecategory" id="${linkId++}" value="${x(v)}"/>`),
      ...g.m.map(v => `    <link type="boardgamemechanic" id="${linkId++}" value="${x(v)}"/>`),
      ...(g.f || []).map(v => `    <link type="boardgamefamily" id="${linkId++}" value="${x(v)}"/>`),
      `    <link type="boardgamefamily" id="${linkId++}" value="Players: Games with Solitaire Rules"/>`,
      `    <link type="boardgamedesigner" id="${linkId++}" value="Some Designer"/>`,
      `    <link type="boardgamepublisher" id="${linkId++}" value="Some Publisher"/>`
    ].join('\n');
    return `  <item type="boardgame" id="${g.id}">
    <thumbnail>${x(thumb(g.id))}</thumbnail>
    <image>https://cf.geekdo-images.com/Hash${g.id}Abc__original/img/Orig${g.id}=/0x0/filters:format(jpeg)/pic${g.id}.jpg</image>
    <name type="primary" sortindex="1" value="${x(g.n)}"/>
    <name type="alternate" sortindex="1" value="${x(g.n)} (Alt)"/>
    <description>A game about things.&amp;#10;&amp;#10;Players do stuff &amp;mdash; and it&amp;#039;s fun.</description>
    <yearpublished value="${g.y}"/>
    <minplayers value="${g.p0}"/>
    <maxplayers value="${g.p1}"/>
    <poll name="suggested_numplayers" title="User Suggested Number of Players" totalvotes="321">
${poll}
    </poll>
    <poll-summary name="suggested_numplayers" title="User Suggested Number of Players">
      <result name="bestwith" value="Best with 4 players"/>
      <result name="recommmendedwith" value="Recommended with 3–4 players"/>
    </poll-summary>
    <playingtime value="${g.t}"/>
    <minplaytime value="${Math.round(g.t / 2)}"/>
    <maxplaytime value="${g.t}"/>
    <minage value="10"/>
    <poll name="suggested_playerage" title="User Suggested Player Age" totalvotes="10"><results><result value="2" numvotes="0"/></results></poll>
    <poll name="language_dependence" title="Language Dependence" totalvotes="10"><results><result level="1" value="No necessary in-game text" numvotes="7"/></results></poll>
${links}
    <statistics page="1">
      <ratings>
        <usersrated value="4321"/>
        <average value="${g.ba}"/>
        <bayesaverage value="6.9"/>
        ${ranks(g, false)}
        <stddev value="1.3"/>
        <median value="0"/>
        <owned value="12345"/>
        <trading value="12"/>
        <wanting value="34"/>
        <wishing value="56"/>
        <numcomments value="78"/>
        <numweights value="90"/>
        <averageweight value="${g.w}"/>
      </ratings>
    </statistics>
  </item>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
${items.join('\n')}
</items>`;
}
export const EXPANSION_ITEM = `  <item objecttype="thing" objectid="926" subtype="boardgameexpansion" collid="555">
    <name sortindex="1">CATAN: Seafarers</name>
    <yearpublished>1997</yearpublished>
    <stats minplayers="3" maxplayers="4" playingtime="90"><rating value="N/A"><average value="7.1"/><ranks><rank type="subtype" id="1" name="boardgame" friendlyname="Board Game Rank" value="Not Ranked"/></ranks></rating></stats>
    <status own="1"/>
    <numplays>0</numplays>
  </item>`;
export const PREVOWNED_ITEM = `  <item objecttype="thing" objectid="2651" subtype="boardgame" collid="556">
    <name sortindex="1">Power Grid</name>
    <yearpublished>2004</yearpublished>
    <stats minplayers="2" maxplayers="6" playingtime="120"><rating value="8"><average value="7.8"/><ranks/></rating></stats>
    <status own="0" prevowned="1"/>
    <numplays>3</numplays>
  </item>`;
export const QUEUED = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<message>\n\tYour request for this collection has been accepted and will be processed.  Please try again later for access.\n</message>';
export const BAD_USER = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<errors>\n\t<error>\n\t\t<message>Invalid username specified</message>\n\t</error>\n</errors>';
