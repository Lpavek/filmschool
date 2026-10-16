const TMDB_API_KEY = '8818385dc34c1143c1b2589f2d36f790';
mapboxgl.accessToken = 'pk.eyJ1IjoibHVxcWV5IiwiYSI6ImNtdmF4MXg3OTA4c3oyeXI0aTgzNnM5MW4ifQ.ZoG892NR3JW26wh-ZGdPRg';

// Globální stavy
let map, timeline, network;
let timelineItems = new vis.DataSet([]);
let nodes = new vis.DataSet([]);
let edges = new vis.DataSet([]);
let currentMarkers = [];
let currentEntity = null;
let isRotating = true;
let mapIdleTimer;

let repertoire = JSON.parse(localStorage.getItem('cinematicRepertoirePRO')) || [];

function initApp() {
    // 1. Mapbox (3D Globe)
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [15, 45],
        zoom: 1.8,
        projection: 'globe'
    });

    map.on('style.load', () => { map.setFog({}); });
    
    // Idle logika mapy - automatická rotace po 12s nečinnosti
    const resetIdle = () => {
        isRotating = false;
        clearTimeout(mapIdleTimer);
        mapIdleTimer = setTimeout(() => { isRotating = true; rotateGlobe(); }, 12000);
    };
    ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart'].forEach(e => map.on(e, resetIdle));
    map.on('moveend', () => { if(isRotating) rotateGlobe(); });
    rotateGlobe();

    // 2. Timeline
    timeline = new vis.Timeline(document.getElementById('timeline-container'), timelineItems, {
        start: '1970-01-01', end: '2030-01-01', height: '100%', zoomMin: 1000 * 60 * 60 * 24 * 365,
    });

    // 3. Node Network (Fusion style) - opravená struktura parametrů pro vis-network
    const netContainer = document.getElementById('network-container');
    const netData = { nodes: nodes, edges: edges };
    const netOptions = {
        nodes: {
            shape: 'box',
            color: { background: '#2b2b2b', border: '#555', highlight: { background: '#444', border: '#FF6600' } },
            font: { color: '#E0E0E0', face: 'monospace', size: 14 },
            borderWidth: 2,
            shapeProperties: {
                borderRadius: 4
            },
            margin: 10
        },
        edges: {
            width: 2,
            color: { color: '#666', highlight: '#FF6600' },
            smooth: { type: 'cubicBezier', forceDirection: 'horizontal', roundness: 0.4 },
            arrows: 'to'
        },
        layout: { hierarchical: { direction: 'LR', sortMethod: 'directed', nodeSpacing: 150, levelSeparation: 250 } },
        physics: false
    };
    network = new vis.Network(netContainer, netData, netOptions);
    
    network.on("selectNode", function (params) {
        const nodeId = params.nodes[0];
        const node = nodes.get(nodeId);
        if (node && node.personId) analyzePerson(node.personId);
    });

    renderRepertoire();
}

function rotateGlobe() {
    if (!isRotating) return;
    if (map.getZoom() < 3) {
        const center = map.getCenter();
        center.lng -= 0.1;
        map.easeTo({ center, duration: 200, easing: n => n });
    }
}

// --- PŘEPÍNÁNÍ POHLEDŮ ---
function switchView(view) {
    document.querySelectorAll('.view-toggles button').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${view}`).classList.add('active');
    
    document.getElementById('map').style.display = 'none';
    document.getElementById('timeline-view').style.display = 'none';
    document.getElementById('network-view').style.display = 'none';

    document.getElementById(view === 'map' ? 'map' : `${view}-view`).style.display = 'block';
    
    if(view === 'map') map.resize();
    if(view === 'timeline') timeline.redraw();
    if(view === 'network') network.fit();
}

// --- VYHLEDÁVÁNÍ ---
function handleEnter(e) { if (e.key === 'Enter') searchAction(); }

async function searchAction() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;

    const resDiv = document.getElementById('results-content');
    resDiv.innerHTML = `<p class="neon-text">Querying TMDB...</p>`;
    document.getElementById('entity-profile').style.display = 'none';
    document.getElementById('filmography-section').style.display = 'none';

    try {
        const res = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        const filtered = data.results.filter(r => r.media_type === 'person' || r.media_type === 'movie').slice(0, 5);
        if (filtered.length > 0) {
            resDiv.innerHTML = '';
            filtered.forEach(item => {
                const title = item.media_type === 'movie' ? item.title : item.name;
                const typeLabel = item.media_type === 'movie' ? '🎬 Film' : '👤 Person';
                
                const div = document.createElement('div');
                div.className = 'film-item';
                
                const infoDiv = document.createElement('div');
                infoDiv.className = 'film-info';
                infoDiv.innerHTML = `<strong class="neon-text">${title}</strong> <span style="font-size:10px;color:#888;">(${typeLabel})</span>`;
                
                const btn = document.createElement('button');
                btn.className = 'action-btn';
                btn.textContent = 'Analyze';
                btn.addEventListener('click', () => {
                    if (item.media_type === 'movie') {
                        analyzeMovie(item.id);
                    } else {
                        analyzePerson(item.id);
                    }
                });

                div.appendChild(infoDiv);
                div.appendChild(btn);
                resDiv.appendChild(div);
            });
        } else { resDiv.innerHTML = `<p>No matches found.</p>`; }
    } catch (err) { resDiv.innerHTML = `<p style="color:red;">Error fetching data.</p>`; }
}

// --- OSOBY ---
async function analyzePerson(id) {
    document.getElementById('results-content').innerHTML = '';
    clearVisuals();
    
    const detRes = await fetch(`https://api.themoviedb.org/3/person/${id}?api_key=${TMDB_API_KEY}`);
    const person = await detRes.json();
    
    const credRes = await fetch(`https://api.themoviedb.org/3/person/${id}/movie_credits?api_key=${TMDB_API_KEY}`);
    const credits = await credRes.json();

    let works = [];
    if (person.known_for_department === 'Acting') { works = credits.cast; } 
    else { works = credits.crew.filter(c => c.department === person.known_for_department); }
    
    works = Array.from(new Map(works.filter(w => w.release_date).map(item => [item.id, item])).values())
            .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

    currentEntity = { type: 'person', id: person.id, name: person.name, job: person.known_for_department, works: works };

    renderPersonProfile(person, works.length);
    renderFilmographyList(works);
    populateTimeline(works, person.name);
    
    if (person.place_of_birth) geocodeAndZoom(person.place_of_birth);
    
    document.getElementById('btn-network').style.display = 'none';
    switchView('map');
}

function renderPersonProfile(person, totalFilms) {
    document.getElementById('entity-profile').style.display = 'block';
    document.getElementById('entity-name').innerText = person.name;
    
    const imgEl = document.getElementById('entity-photo');
    imgEl.src = person.profile_path ? `https://image.tmdb.org/t/p/w200${person.profile_path}` : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    
    let detailsHtml = '';
    if (person.known_for_department) detailsHtml += `<div><span class="label">Profession:</span> ${person.known_for_department}</div>`;
    if (person.birthday) detailsHtml += `<div><span class="label">Born:</span> ${person.birthday}</div>`;
    if (person.deathday) detailsHtml += `<div><span class="label">Died:</span> ${person.deathday}</div>`;
    if (person.place_of_birth) detailsHtml += `<div><span class="label">Location:</span> <span class="interactive-link" onclick="geocodeAndZoom('${person.place_of_birth.replace(/'/g, "\\'")}')">${person.place_of_birth}</span></div>`;
    if (totalFilms > 0) detailsHtml += `<div><span class="label">Total works:</span> ${totalFilms}</div>`;
    
    document.getElementById('entity-details').innerHTML = detailsHtml;
    document.getElementById('entity-bio').innerText = person.biography || '';
    
    const existing = repertoire.find(r => r.id === person.id);
    document.getElementById('entity-actions').innerHTML = `
        <button class="btn-icon" title="${existing ? 'In Repertoire' : 'Add to Repertoire'}" onclick="forceAddToRepertoire()" style="width: auto; padding: 0 10px;">
            ${existing ? '📌 Added' : '+ Add'}
        </button>
    `;
}

// --- FILMY ---
async function analyzeMovie(id) {
    document.getElementById('results-content').innerHTML = '';
    clearVisuals();
    
    const detRes = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}`);
    const movie = await detRes.json();
    
    const credRes = await fetch(`https://api.themoviedb.org/3/movie/${id}/credits?api_key=${TMDB_API_KEY}`);
    const credits = await credRes.json();

    currentEntity = { type: 'movie', id: movie.id, title: movie.title };

    renderMovieProfile(movie);
    
    if(movie.production_countries && movie.production_countries.length > 0) {
        movie.production_countries.forEach(c => geocodeAndAddMarker(c.name, movie.title));
    }

    if (movie.release_date) {
        timeline.addCustomTime(movie.release_date, 'movie-release');
    }
    
    buildMovieNetwork(movie, credits);
    
    document.getElementById('btn-network').style.display = 'block';
    switchView('network');
}

function renderMovieProfile(movie) {
    document.getElementById('entity-profile').style.display = 'block';
    document.getElementById('filmography-section').style.display = 'none';
    document.getElementById('entity-name').innerText = movie.title;
    
    const imgEl = document.getElementById('entity-photo');
    imgEl.src = movie.poster_path ? `https://image.tmdb.org/t/p/w200${movie.poster_path}` : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    
    const year = movie.release_date ? movie.release_date.split('-')[0] : '';
    const genres = movie.genres ? movie.genres.map(g => g.name).join(', ') : '';
    
    let detailsHtml = `<div><span class="label">Year:</span> <span class="interactive-link" onclick="timeline.setWindow('${year}-01-01', '${parseInt(year)+1}-01-01'); switchView('timeline');">${year}</span></div>`;
    if(movie.runtime) detailsHtml += `<div><span class="label">Runtime:</span> ${movie.runtime} min</div>`;
    if(genres) detailsHtml += `<div><span class="label">Genres:</span> ${genres}</div>`;
    
    if (movie.imdb_id) {
        document.getElementById('entity-actions').innerHTML = `<a href="https://www.imdb.com/title/${movie.imdb_id}" target="_blank" class="btn-icon imdb-link" title="IMDb">🔗</a>`;
    } else {
        document.getElementById('entity-actions').innerHTML = '';
    }

    document.getElementById('entity-details').innerHTML = detailsHtml;
    document.getElementById('entity-bio').innerText = movie.overview || '';
}

function buildMovieNetwork(movie, credits) {
    nodes.clear(); edges.clear();
    
    nodes.add({ id: 'm', label: movie.title, level: 2, color: { background: '#111', border: '#FF6600' }, font: { size: 18, color: '#FF6600' }});
    
    const addNode = (crewMember, role, level) => {
        if(!crewMember) return;
        const nId = `p_${crewMember.id}_${role.replace(/\s/g,'')}`;
        if(!nodes.get(nId)) {
            nodes.add({ id: nId, label: `${role}\n${crewMember.name}`, level: level, personId: crewMember.id });
            edges.add({ from: nId, to: 'm' });
        }
    };

    const dir = credits.crew.find(c => c.job === 'Director'); addNode(dir, 'Director', 1);
    const dop = credits.crew.find(c => c.department === 'Camera'); addNode(dop, 'Cinematography', 1);
    const ed = credits.crew.find(c => c.department === 'Editing'); addNode(ed, 'Editor', 3);
    const wr = credits.crew.find(c => c.department === 'Writing'); addNode(wr, 'Writer', 1);
    const mus = credits.crew.find(c => c.job === 'Original Music Composer' || c.department === 'Sound'); addNode(mus, 'Music', 3);
    
    credits.cast.slice(0,3).forEach((actor) => {
        const nId = `a_${actor.id}`;
        nodes.add({ id: nId, label: `Cast\n${actor.name}`, level: 0, personId: actor.id, color: { background: '#1a1a2e', border: '#5c5cff' } });
        edges.add({ from: nId, to: 'm' });
    });
}

// --- VÝPIS FILMOGRAFIE ---
function renderFilmographyList(works) {
    const listDiv = document.getElementById('filmography-list');
    document.getElementById('filmography-section').style.display = 'block';
    listDiv.innerHTML = '';
    
    const repData = repertoire.find(r => r.id === currentEntity.id);
    const seenArray = repData ? repData.seen : [];
    const wishArray = repData ? repData.wish : [];

    works.forEach(m => {
        const year = m.release_date ? m.release_date.split('-')[0] : '????';
        const isSeen = seenArray.includes(m.id);
        const isWish = wishArray && wishArray.includes(m.id);

        const div = document.createElement('div');
        div.className = 'film-item';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'film-info';
        
        const yearSpan = document.createElement('span');
        yearSpan.className = 'film-year';
        yearSpan.textContent = year;
        yearSpan.title = 'Show on Timeline';
        yearSpan.addEventListener('click', () => jumpToYear(m.release_date));

        const titleSpan = document.createElement('span');
        titleSpan.className = 'film-title';
        titleSpan.textContent = m.title;
        titleSpan.addEventListener('click', () => analyzeMovie(m.id));

        infoDiv.appendChild(yearSpan);
        infoDiv.appendChild(titleSpan);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'film-actions';

        const seenBtn = document.createElement('button');
        seenBtn.className = `btn-icon ${isSeen ? 'active-seen' : ''}`;
        seenBtn.textContent = '✓';
        seenBtn.title = 'Seen';
        seenBtn.addEventListener('click', () => toggleFilmStatus(m.id, 'seen'));

        const wishBtn = document.createElement('button');
        wishBtn.className = `btn-icon ${isWish && !isSeen ? 'active-wish' : ''}`;
        wishBtn.textContent = 'O';
        wishBtn.title = 'Wishlist';
        wishBtn.addEventListener('click', () => toggleFilmStatus(m.id, 'wish'));

        actionsDiv.appendChild(seenBtn);
        actionsDiv.appendChild(wishBtn);

        div.appendChild(infoDiv);
        div.appendChild(actionsDiv);
        listDiv.appendChild(div);
    });
}

// --- REPERTOÁR LOGIKA ---
function toggleFilmStatus(filmId, type) {
    if (currentEntity.type !== 'person') return;
    
    let repItem = repertoire.find(r => r.id === currentEntity.id);
    
    if (!repItem) {
        repItem = { id: currentEntity.id, name: currentEntity.name, total: currentEntity.works.length, seen: [], wish: [], pinned: false, hidden: false };
        repertoire.push(repItem);
    } else {
        repItem.total = currentEntity.works.length;
    }

    if (type === 'seen') {
        if (repItem.seen.includes(filmId)) repItem.seen = repItem.seen.filter(id => id !== filmId);
        else { repItem.seen.push(filmId); repItem.wish = (repItem.wish||[]).filter(id => id !== filmId); }
    } else if (type === 'wish') {
        if (!repItem.wish) repItem.wish = [];
        if (repItem.wish.includes(filmId)) repItem.wish = repItem.wish.filter(id => id !== filmId);
        else { repItem.wish.push(filmId); repItem.seen = repItem.seen.filter(id => id !== filmId); }
    }

    saveRepertoire();
    renderFilmographyList(currentEntity.works);
}

function forceAddToRepertoire() {
    if (!currentEntity || currentEntity.type !== 'person') return;
    if (!repertoire.find(r => r.id === currentEntity.id)) {
        repertoire.push({ id: currentEntity.id, name: currentEntity.name, total: currentEntity.works.length, seen: [], wish: [], pinned: false, hidden: false });
        saveRepertoire();
        renderPersonProfile(currentEntity, currentEntity.works.length);
    }
}

function toggleRepertoireAttr(id, attr) {
    const item = repertoire.find(r => r.id === id);
    if(item) {
        item[attr] = !item[attr];
        saveRepertoire();
    }
}

function saveRepertoire() {
    localStorage.setItem('cinematicRepertoirePRO', JSON.stringify(repertoire));
    renderRepertoire();
}

function calculateScoreColor(seen, total) {
    if (total === 0) return '#666';
    const ratio = Math.min(seen / total, 1);
    const r = ratio < 0.5 ? 255 : Math.floor(255 - (ratio - 0.5) * 2 * 255);
    const g = ratio > 0.5 ? 255 : Math.floor(ratio * 2 * 255);
    return `rgb(${r}, ${g}, 0)`;
}

function renderRepertoire() {
    const listDiv = document.getElementById('repertoire-list');
    listDiv.innerHTML = '';
    
    const visibility = document.getElementById('filter-visibility').value;
    const sortOrder = document.getElementById('filter-sort').value;

    let filtered = repertoire.filter(item => {
        if (visibility === 'main') return !item.hidden;
        if (visibility === 'hidden') return item.hidden;
        return true;
    });

    filtered.sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
        const scoreA = a.total > 0 ? (a.seen.length / a.total) : 0;
        const scoreB = b.total > 0 ? (b.seen.length / b.total) : 0;
        return sortOrder === 'desc' ? scoreB - scoreA : scoreA - scoreB;
    });

    filtered.forEach(item => {
        const color = calculateScoreColor(item.seen.length, item.total);
        const div = document.createElement('div');
        div.className = `repertoire-item ${item.pinned ? 'pinned' : ''} ${item.hidden ? 'hidden-item' : ''}`;
        div.style.borderLeftColor = color;
        
        const infoDiv = document.createElement('div');
        infoDiv.className = 'rep-info';
        infoDiv.addEventListener('click', () => analyzePerson(item.id));
        infoDiv.innerHTML = `
            <span class="rep-name">${item.name}</span>
            <span class="rep-score" style="color:${color}">${item.seen.length} / ${item.total}</span>
        `;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'rep-actions';

        const pinBtn = document.createElement('button');
        pinBtn.className = 'btn-icon';
        pinBtn.style.border = 'none';
        pinBtn.textContent = '📌';
        pinBtn.title = 'Pin';
        pinBtn.addEventListener('click', () => toggleRepertoireAttr(item.id, 'pinned'));

        const hideBtn = document.createElement('button');
        hideBtn.className = 'btn-icon';
        hideBtn.style.border = 'none';
        hideBtn.textContent = '👁️‍🗨️';
        hideBtn.title = 'Hide';
        hideBtn.addEventListener('click', () => toggleRepertoireAttr(item.id, 'hidden'));

        actionsDiv.appendChild(pinBtn);
        actionsDiv.appendChild(hideBtn);

        div.appendChild(infoDiv);
        div.appendChild(actionsDiv);
        listDiv.appendChild(div);
    });
}

// --- POMOCNÉ FUNKCE ---
function clearVisuals() {
    currentMarkers.forEach(m => m.remove());
    currentMarkers = [];
    timelineItems.clear();
    try { timeline.removeCustomTime('movie-release'); } catch(e){}
}

function jumpToYear(dateString) {
    if(!dateString) return;
    timeline.setSelection([]);
    timeline.setWindow(new Date(new Date(dateString).setFullYear(new Date(dateString).getFullYear() - 1)), 
                       new Date(new Date(dateString).setFullYear(new Date(dateString).getFullYear() + 1)));
    switchView('timeline');
}

function populateTimeline(works, groupName) {
    works.forEach((m, idx) => {
        if(m.release_date) {
            timelineItems.add({ id: idx, content: m.title, start: m.release_date, className: 'film-node' });
        }
    });
    timeline.fit();
}

async function geocodeAndZoom(locationString) {
    try {
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locationString)}.json?access_token=${mapboxgl.accessToken}`);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            const center = data.features[0].center;
            switchView('map');
            map.flyTo({ center: center, zoom: 6, essential: true });
        }
    } catch(e) { console.error("Geocoding failed"); }
}

async function geocodeAndAddMarker(locationString, movieTitle) {
    try {
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(locationString)}.json?access_token=${mapboxgl.accessToken}`);
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            const lng = data.features[0].center[0];
            const lat = data.features[0].center[1];
            
            const el = document.createElement('div');
            el.className = 'custom-marker';
            const popup = new mapboxgl.Popup({ offset: 15 }).setHTML(`<div style="color:var(--neon-orange);font-weight:bold;">${locationString}</div><div style="font-size:11px;">🎬 ${movieTitle}</div>`);
            const marker = new mapboxgl.Marker(el).setLngLat([lng, lat]).setPopup(popup).addTo(map);
            currentMarkers.push(marker);
        }
    } catch(e) {}
}

window.onload = initApp;
