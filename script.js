// --- FIREBASE CONFIGURATION ---
// Values will be replaced by GitHub Secrets during deployment or can be filled manually.
const firebaseConfig = {
    apiKey: "AIzaSyCqqX-MlKAVot1maPYOztvG13ZUxfsRjgc",
    authDomain: "ptak-o-food.firebaseapp.com",
    projectId: "ptak-o-food",
    storageBucket: "ptak-o-food.firebasestorage.app",
    messagingSenderId: "668261675451",
    appId: "1:668261675451:web:c6c459211b3339cc06d49e",
    measurementId: "G-YJHBE6F3TX"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
document.getElementById('current-date').innerText = new Date().toLocaleDateString('pl-PL', dateOptions);

let dailyMenu = [];
let restaurantName = "Ładowanie...";
let orderLimit = "";
let orders = [];
let history = [];
let profiles = {};
let restaurants = [];
let libraryItems = [];
let composerSelectedIds = new Set();
let menuMode = "fixed";
let parsedDailyMenu = [];
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "ptak123";
const USER_NAME_STORAGE_KEY = "ptakUserName";

function showToast(message, type = "info") {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    container.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add('is-leaving');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 2600);
}

function initRememberedUserName() {
    const userNameInput = document.getElementById('user-name');
    if (!userNameInput) return;

    userNameInput.value = localStorage.getItem(USER_NAME_STORAGE_KEY) || "";
    userNameInput.addEventListener('input', () => {
        const userName = userNameInput.value.trim();
        if (userName) {
            localStorage.setItem(USER_NAME_STORAGE_KEY, userName);
        } else {
            localStorage.removeItem(USER_NAME_STORAGE_KEY);
        }
        renderOrderPreview();
    });
}

function getSelectedMenuItem() {
    const itemId = document.getElementById('item-select-id')?.value;
    if (!itemId) return null;
    return dailyMenu.find(item => String(item.id) === String(itemId)) || null;
}

function getLibraryItemsForCurrentRestaurant() {
    const currentRestaurant = getCurrentRestaurantRecord();

    return libraryItems
        .filter(item => (currentRestaurant?.id && item.restaurantId === currentRestaurant.id) || item.restaurant === restaurantName)
        .sort((a, b) => {
            const categoryCompare = (a.category || "").localeCompare(b.category || "", 'pl');
            if (categoryCompare !== 0) return categoryCompare;
            return a.name.localeCompare(b.name, 'pl');
        });
}

function restaurantDocId(name) {
    const normalized = name.trim().toLowerCase()
        .replace(/[\/\\#?]/g, '')
        .replace(/\s+/g, '-');

    return normalized || `restaurant-${Date.now()}`;
}

function getCurrentRestaurantRecord() {
    return restaurants.find(restaurant => restaurant.name === restaurantName) || null;
}

function getKnownRestaurants() {
    const byName = new Map();

    restaurants.forEach(restaurant => {
        if (restaurant.name) byName.set(restaurant.name, restaurant);
    });

    if (restaurantName && restaurantName !== "Ładowanie...") {
        byName.set(restaurantName, {
            id: restaurantDocId(restaurantName),
            name: restaurantName
        });
    }

    libraryItems.forEach(item => {
        if (item.restaurant && !byName.has(item.restaurant)) {
            byName.set(item.restaurant, {
                id: restaurantDocId(item.restaurant),
                name: item.restaurant
            });
        }
    });

    history.forEach(entry => {
        if (entry.restaurant && !byName.has(entry.restaurant)) {
            byName.set(entry.restaurant, {
                id: restaurantDocId(entry.restaurant),
                name: entry.restaurant
            });
        }
    });

    Object.entries(profiles).forEach(([profileName, profile]) => {
        const profileRestaurant = profile.restaurantName || profile.name || profileName;
        if (profileRestaurant && !byName.has(profileRestaurant)) {
            byName.set(profileRestaurant, {
                id: restaurantDocId(profileRestaurant),
                name: profileRestaurant,
                menuMode: profile.menuMode,
                lastMenu: profile.menu
            });
        }
    });

    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

function findRestaurantRecord(value) {
    return restaurants.find(restaurant => restaurant.id === value || restaurant.name === value)
        || getKnownRestaurants().find(restaurant => restaurant.id === value || restaurant.name === value)
        || null;
}

function buildRestaurantPayload(name, overrides = {}) {
    return {
        name,
        menuMode,
        lastMenu: dailyMenu,
        lastOrderLimit: orderLimit,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        ...overrides
    };
}

function upsertRestaurant(name, overrides = {}) {
    if (!name) return Promise.resolve();

    const existing = restaurants.find(restaurant => restaurant.name === name);
    const docId = existing?.id || restaurantDocId(name);

    return db.collection("restaurants").doc(docId).set(
        buildRestaurantPayload(name, overrides),
        { merge: true }
    );
}

function menuItemFromLibraryItem(item) {
    return {
        id: item.id,
        libraryId: item.id,
        name: item.name,
        price: item.price,
        category: item.category || "Inne"
    };
}

function menuItemFromParsedItem(item, index) {
    return {
        id: `daily-${Date.now()}-${index}`,
        name: item.name,
        price: item.price,
        category: item.category || "Menu dnia",
        source: "daily"
    };
}

function syncComposerSelectionFromMenu() {
    const nextSelection = new Set();

    dailyMenu.forEach(menuItem => {
        const exactLibraryId = menuItem.libraryId || menuItem.id;
        const exactMatch = libraryItems.find(item => item.id === String(exactLibraryId));
        const fallbackMatch = libraryItems.find(item =>
            item.restaurant === restaurantName &&
            item.name === menuItem.name &&
            Number(item.price) === Number(menuItem.price)
        );

        const matchedItem = exactMatch || fallbackMatch;
        if (matchedItem) nextSelection.add(matchedItem.id);
    });

    composerSelectedIds = nextSelection;
}

function renderOrderPreview() {
    const preview = document.getElementById('order-preview');
    if (!preview) return;

    const userName = document.getElementById('user-name')?.value.trim();
    const selectedItem = getSelectedMenuItem();

    if (!userName || !selectedItem || isOrderingClosed()) {
        preview.classList.add('is-hidden');
        preview.innerText = "";
        return;
    }

    preview.innerText = `${userName} zamawia: ${selectedItem.name} za ${selectedItem.price.toFixed(2)} zł`;
    preview.classList.remove('is-hidden');
}

function isAdminLoggedIn() {
    return localStorage.getItem('ptakIsAdmin') === 'true' || sessionStorage.getItem('ptakIsAdmin') === 'true';
}

function isOrderingClosed() {
    if (!orderLimit) return false;

    const [limitHours, limitMinutes] = orderLimit.split(':').map(Number);
    if (Number.isNaN(limitHours) || Number.isNaN(limitMinutes)) return false;

    const now = new Date();
    const limitDate = new Date();
    limitDate.setHours(limitHours, limitMinutes, 0, 0);

    return now > limitDate;
}

function updateAdminUI() {
    const isAdmin = isAdminLoggedIn();
    const loginForm = document.getElementById('admin-login-form');
    const adminControls = document.getElementById('admin-controls');
    const usernameInput = document.getElementById('admin-username');
    const adminStatus = document.getElementById('admin-status');

    document.querySelectorAll('.admin-only').forEach(el => {
        el.classList.toggle('is-hidden', !isAdmin);
    });

    if (usernameInput && !usernameInput.value) {
        usernameInput.value = localStorage.getItem('ptakAdminUser') || "";
    }
    if (adminStatus) adminStatus.classList.toggle('is-hidden', !isAdmin);
    if (loginForm) loginForm.classList.toggle('is-hidden', isAdmin);
    if (adminControls) adminControls.classList.toggle('is-hidden', !isAdmin);
    renderOrders();
    renderHistory();
}

function initApp() {
    db.collection("config").doc("current").onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            restaurantName = data.restaurantName || "Bistro pod Pijanym Ptakiem";
            dailyMenu = data.menu || [];
            orderLimit = data.orderLimit || "";
            syncComposerSelectionFromMenu();

            renderRestaurantName();
            renderDaySummary();
            renderRestaurantSuggestions();
            renderMenu();
            renderAdminMenu();
            renderOrderLimitInfo();
            updateOrderAvailability();
            renderOrders();
        } else {
            db.collection("config").doc("current").set({
                restaurantName: "Bistro pod Pijanym Ptakiem",
                menu: [],
                orderLimit: ""
            });
        }
    });

    db.collection("orders").orderBy("timestamp", "asc").onSnapshot((snapshot) => {
        orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderOrders();
    });

    db.collection("history").orderBy("timestamp", "desc").limit(10).onSnapshot((snapshot) => {
        history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderHistory();
        renderRestaurantSuggestions();
    });

    db.collection("profiles").onSnapshot((snapshot) => {
        profiles = {};
        snapshot.docs.forEach(doc => {
            profiles[doc.id] = doc.data();
        });
        renderRestaurantSuggestions();
    });

    db.collection("restaurants").onSnapshot((snapshot) => {
        restaurants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderRestaurantSuggestions();
        renderMenuMode();
        renderMenuDayPreview();
    });

    db.collection("dishLibrary").onSnapshot((snapshot) => {
        libraryItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        syncComposerSelectionFromMenu();
        renderAdminMenu();
        renderCategoryFilter();
        renderMenuDayPreview();
        renderRestaurantSuggestions();
    });
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const activeBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    const activeContent = document.getElementById(tabId);
    if (activeContent) activeContent.classList.add('active');

    if (tabId === 'admin-tab') {
        const restaurantInput = document.getElementById('admin-restaurant-name');
        const limitInput = document.getElementById('admin-order-limit');
        if (restaurantInput) restaurantInput.value = restaurantName;
        if (limitInput) limitInput.value = orderLimit;
        renderRestaurantSuggestions();
        renderMenuMode();
        renderCategoryFilter();
        renderAdminMenu();
        renderMenuDayPreview();
        updateAdminUI();
    }
}

function loginAdmin(event) {
    event.preventDefault();

    const usernameInput = document.getElementById('admin-username');
    const passwordInput = document.getElementById('admin-password');
    const rememberInput = document.getElementById('remember-admin');
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        showToast("Błędny użytkownik lub hasło.", "error");
        return;
    }

    if (rememberInput.checked) {
        localStorage.setItem('ptakIsAdmin', 'true');
        localStorage.setItem('ptakAdminUser', username);
        sessionStorage.removeItem('ptakIsAdmin');
    } else {
        sessionStorage.setItem('ptakIsAdmin', 'true');
        localStorage.removeItem('ptakIsAdmin');
        localStorage.removeItem('ptakAdminUser');
    }

    passwordInput.value = "";
    updateAdminUI();
    showToast("Zalogowano jako admin.", "success");
}

function logoutAdmin() {
    localStorage.removeItem('ptakIsAdmin');
    localStorage.removeItem('ptakAdminUser');
    sessionStorage.removeItem('ptakIsAdmin');
    updateAdminUI();
    switchTab('orders-tab');
    showToast("Wylogowano z panelu administratora.", "info");
}

function updateOrderLimit() {
    const limitInput = document.getElementById('admin-order-limit').value;
    db.collection("config").doc("current").update({ orderLimit: limitInput })
        .then(() => showToast("Zaktualizowano limit czasu.", "success"))
        .catch(err => console.error("Error updating limit:", err));
}

function updateDaySettings() {
    const newName = document.getElementById('admin-restaurant-name').value.trim();
    const limitInput = document.getElementById('admin-order-limit').value;

    if (!newName) {
        showToast("Podaj nazwę restauracji.", "error");
        return;
    }

    const updates = {
        restaurantName: newName,
        orderLimit: limitInput
    };

    Promise.all([
        db.collection("config").doc("current").update(updates),
        upsertRestaurant(newName, {
            menuMode,
            lastMenu: dailyMenu,
            lastOrderLimit: limitInput
        })
    ])
        .then(() => showToast("Zapisano restaurację i godzinę zamówień.", "success"))
        .catch(err => console.error("Error updating day settings:", err));
}

function applyRestaurantSelection(value) {
    if (!value) return;

    const restaurantInput = document.getElementById('admin-restaurant-name');
    const quickSelect = document.getElementById('restaurant-quick-select');
    const selectedRestaurant = findRestaurantRecord(value);
    const selectedName = selectedRestaurant?.name || value;

    if (restaurantInput) restaurantInput.value = selectedName;
    if (quickSelect) quickSelect.value = selectedRestaurant?.id || "";

    if (selectedRestaurant?.menuMode) {
        menuMode = selectedRestaurant.menuMode;
        renderMenuMode();
    }

    if (selectedRestaurant?.lastMenu?.length) {
        dailyMenu = selectedRestaurant.lastMenu;
    }

    if (selectedRestaurant?.lastOrderLimit) {
        const limitInput = document.getElementById('admin-order-limit');
        orderLimit = selectedRestaurant.lastOrderLimit;
        if (limitInput) limitInput.value = selectedRestaurant.lastOrderLimit;
    }

    const update = { restaurantName: selectedName };
    if (selectedRestaurant?.lastMenu?.length) update.menu = selectedRestaurant.lastMenu;
    if (selectedRestaurant?.lastOrderLimit) update.orderLimit = selectedRestaurant.lastOrderLimit;

    db.collection("config").doc("current").update(update)
        .then(() => {
            showToast(
                selectedRestaurant?.lastMenu?.length
                    ? "Wybrano restaurację i wczytano jej zapisane menu."
                    : "Wybrano restaurację.",
                "success"
            );
        })
        .catch(err => console.error("Error applying restaurant:", err));
}

function renderRestaurantSuggestions() {
    const datalist = document.getElementById('restaurant-suggestions');
    const quickSelect = document.getElementById('restaurant-quick-select');
    const knownRestaurants = getKnownRestaurants();
    const names = knownRestaurants.map(restaurant => restaurant.name);

    if (datalist) {
        datalist.innerHTML = "";
        names.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            datalist.appendChild(option);
        });
    }

    if (quickSelect) {
        const currentRecord = restaurants.find(restaurant => restaurant.name === restaurantName);
        const currentValue = quickSelect.value || currentRecord?.id || "";
        quickSelect.innerHTML = '<option value="">Wybierz z ostatnich restauracji</option>';
        knownRestaurants.forEach(restaurant => {
            const option = document.createElement('option');
            option.value = restaurant.id || restaurant.name;
            option.innerText = restaurant.name;
            quickSelect.appendChild(option);
        });
        quickSelect.value = knownRestaurants.some(restaurant => (restaurant.id || restaurant.name) === currentValue)
            ? currentValue
            : "";
    }
}

function renderOrderLimitInfo() {
    const infoContainer = document.getElementById('order-limit-display');
    if (!infoContainer) return;

    if (!restaurantName && !orderLimit) {
        infoContainer.innerText = "";
    } else if (orderLimit) {
        const status = isOrderingClosed() ? "zamówienia zamknięte" : `zamówienia do ${orderLimit}`;
        infoContainer.innerText = `${restaurantName || "Restauracja"} · ${status}`;
    } else {
        infoContainer.innerText = `${restaurantName} · bez limitu`;
    }
    infoContainer.classList.toggle('is-closed', isOrderingClosed());
}

function updateRestaurantName() {
    const newName = document.getElementById('admin-restaurant-name').value.trim();
    if (newName !== "") {
        db.collection("config").doc("current").update({ restaurantName: newName })
            .then(() => showToast("Zaktualizowano nazwę restauracji.", "success"))
            .catch(err => console.error("Error updating name:", err));
    }
}

function renderRestaurantName() {
    document.getElementById('restaurant-name').innerText = restaurantName;
}

function renderDaySummary() {
    const summary = document.getElementById('today-order-info');
    const adminSummary = document.getElementById('admin-day-summary');
    const limitText = orderLimit ? `do ${orderLimit}` : "bez limitu czasu";
    const statusText = `${isOrderingClosed() ? "Zamówienia zamknięte" : "Zamówienia otwarte"} ${limitText}.`;
    const adminText = `Dziś zamawiamy z: ${restaurantName}. Zamówienia ${limitText}.`;

    if (summary) summary.innerText = statusText;
    if (adminSummary) adminSummary.innerText = adminText;
}

function addMenuItem() {
    const nameInput = document.getElementById('admin-item-name').value.trim();
    const priceInput = parseFloat(document.getElementById('admin-item-price').value);
    const categoryInput = document.getElementById('admin-item-category').value.trim() || "Inne";
    const restaurantId = getCurrentRestaurantRecord()?.id || restaurantDocId(restaurantName);

    if (nameInput === "" || isNaN(priceInput)) {
        showToast("Podaj poprawną nazwę i cenę, np. 25.50.", "error");
        return;
    }

    db.collection("dishLibrary").add({
        restaurantId,
        restaurant: restaurantName,
        name: nameInput,
        price: priceInput,
        category: categoryInput,
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then((docRef) => {
            composerSelectedIds.add(docRef.id);
            document.getElementById('admin-item-name').value = "";
            document.getElementById('admin-item-price').value = "";
            document.getElementById('admin-item-category').value = "";
            showToast("Dodano danie do biblioteki.", "success");
        })
        .catch(err => console.error("Error adding library item:", err));
}

function deleteMenuItem(id) {
    if (confirm("Usunąć tę pozycję z biblioteki?")) {
        composerSelectedIds.delete(String(id));
        db.collection("dishLibrary").doc(String(id)).delete()
            .then(() => {
                renderMenuDayPreview();
                showToast("Usunięto danie z biblioteki.", "success");
            });
    }
}

function renderAdminMenu() {
    const adminMenuList = document.getElementById('admin-menu-list');
    if (!adminMenuList) return;
    adminMenuList.innerHTML = "";

    const search = document.getElementById('library-search')?.value.trim().toLowerCase() || "";
    const category = document.getElementById('category-filter')?.value || "";
    const restaurantLibrary = getLibraryItemsForCurrentRestaurant();
    const filteredItems = restaurantLibrary.filter(item => {
        const matchesSearch = !search || item.name.toLowerCase().includes(search);
        const matchesCategory = !category || (item.category || "Inne") === category;
        return matchesSearch && matchesCategory;
    });

    if (restaurantLibrary.length === 0) {
        adminMenuList.innerHTML = '<li class="library-empty">Dodaj pierwsze danie do biblioteki tej restauracji.</li>';
        return;
    }

    if (filteredItems.length === 0) {
        adminMenuList.innerHTML = '<li class="library-empty">Brak dań pasujących do filtrów.</li>';
        return;
    }

    filteredItems.forEach(item => {
        const li = document.createElement('li');
        li.className = 'library-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = composerSelectedIds.has(item.id);
        checkbox.onchange = () => toggleComposedItem(item.id);

        const label = document.createElement('div');
        label.className = 'library-item-main';
        label.innerHTML = `
            <strong>${item.name}</strong>
            <span>${item.category || "Inne"} · ${Number(item.price).toFixed(2)} zł</span>
        `;

        const button = document.createElement('button');
        button.className = 'btn-danger btn-small';
        button.innerText = 'Usuń z biblioteki';
        button.onclick = () => deleteMenuItem(item.id);

        li.append(checkbox, label, button);
        adminMenuList.appendChild(li);
    });
}

function renderCategoryFilter() {
    const select = document.getElementById('category-filter');
    if (!select) return;

    const currentValue = select.value;
    const categories = [...new Set(getLibraryItemsForCurrentRestaurant().map(item => item.category || "Inne"))]
        .sort((a, b) => a.localeCompare(b, 'pl'));

    select.innerHTML = '<option value="">Wszystkie kategorie</option>';
    categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.innerText = category;
        select.appendChild(option);
    });

    select.value = categories.includes(currentValue) ? currentValue : "";
}

function toggleComposedItem(id) {
    const itemId = String(id);
    if (composerSelectedIds.has(itemId)) {
        composerSelectedIds.delete(itemId);
    } else {
        composerSelectedIds.add(itemId);
    }

    renderAdminMenu();
    renderMenuDayPreview();
}

function selectCurrentMenuFromLibrary() {
    syncComposerSelectionFromMenu();
    renderAdminMenu();
    renderMenuDayPreview();
    showToast("Wczytano obecne menu do kompozytora.", "success");
}

function clearComposedMenu() {
    composerSelectedIds.clear();
    renderAdminMenu();
    renderMenuDayPreview();
}

function importCurrentMenuToLibrary() {
    if (dailyMenu.length === 0) {
        showToast("Obecne menu jest puste.", "info");
        return;
    }

    const restaurantLibrary = getLibraryItemsForCurrentRestaurant();
    const itemsToImport = dailyMenu.filter(menuItem => !restaurantLibrary.some(item =>
        item.name === menuItem.name && Number(item.price) === Number(menuItem.price)
    ));

    if (itemsToImport.length === 0) {
        showToast("Obecne menu jest już w bibliotece.", "info");
        syncComposerSelectionFromMenu();
        renderAdminMenu();
        renderMenuDayPreview();
        return;
    }

    const restaurantId = getCurrentRestaurantRecord()?.id || restaurantDocId(restaurantName);
    const writes = itemsToImport.map(menuItem => db.collection("dishLibrary").add({
        restaurantId,
        restaurant: restaurantName,
        name: menuItem.name,
        price: Number(menuItem.price),
        category: menuItem.category || "Inne",
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }));

    Promise.all(writes)
        .then(() => showToast("Zaimportowano obecne menu do biblioteki.", "success"))
        .catch(err => console.error("Error importing current menu:", err));
}

function setMenuMode(mode) {
    menuMode = mode === "daily" ? "daily" : "fixed";
    renderMenuMode();
    renderMenuDayPreview();
}

function renderMenuMode() {
    document.querySelectorAll('input[name="menu-mode"]').forEach(input => {
        input.checked = input.value === menuMode;
    });

    document.querySelectorAll('.fixed-menu-panel').forEach(panel => {
        panel.classList.toggle('is-hidden', menuMode !== "fixed");
    });

    document.querySelectorAll('.daily-menu-panel').forEach(panel => {
        panel.classList.toggle('is-hidden', menuMode !== "daily");
    });
}

function parseDailyMenuLine(line, category) {
    const cleanedLine = line.trim();
    if (!cleanedLine) return null;

    const match = cleanedLine.match(/^(.+?)(?:\s*[-–—:]\s*|\s+)(\d+(?:[,.]\d{1,2})?)\s*(?:zł|zl|pln)?$/i);
    if (!match) {
        return { error: `Nie rozpoznano ceny: ${cleanedLine}` };
    }

    const name = match[1].trim();
    const price = Number(match[2].replace(',', '.'));

    if (!name || Number.isNaN(price)) {
        return { error: `Nie rozpoznano pozycji: ${cleanedLine}` };
    }

    return {
        name,
        price,
        category
    };
}

function parseDailyMenu() {
    const input = document.getElementById('daily-menu-input');
    const categoryInput = document.getElementById('daily-menu-category');
    const errorsContainer = document.getElementById('daily-menu-errors');
    const category = categoryInput?.value.trim() || "Menu dnia";
    const lines = (input?.value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    if (lines.length === 0) {
        parsedDailyMenu = [];
        if (errorsContainer) errorsContainer.classList.add('is-hidden');
        renderMenuDayPreview();
        showToast("Wklej przynajmniej jedną pozycję menu.", "info");
        return;
    }

    const parsedItems = [];
    const errors = [];

    lines.forEach(line => {
        const parsed = parseDailyMenuLine(line, category);
        if (parsed?.error) {
            errors.push(parsed.error);
        } else if (parsed) {
            parsedItems.push(parsed);
        }
    });

    parsedDailyMenu = parsedItems;

    if (errorsContainer) {
        errorsContainer.innerHTML = errors.map(error => `<div>${error}</div>`).join('');
        errorsContainer.classList.toggle('is-hidden', errors.length === 0);
    }

    renderMenuDayPreview();

    if (parsedItems.length > 0) {
        showToast(`Przetworzono ${parsedItems.length} pozycji menu.`, "success");
    } else {
        showToast("Nie udało się rozpoznać żadnej pozycji.", "error");
    }
}

function renderMenuDayPreview() {
    const preview = document.getElementById('menu-day-preview');
    if (!preview) return;

    const selectedItems = menuMode === "daily"
        ? parsedDailyMenu
        : getLibraryItemsForCurrentRestaurant().filter(item => composerSelectedIds.has(item.id));

    if (selectedItems.length === 0) {
        preview.innerHTML = menuMode === "daily"
            ? '<p class="note-text">Wklej menu i kliknij Przetwórz menu.</p>'
            : '<p class="note-text">Zaznacz dania z biblioteki, żeby złożyć menu dnia.</p>';
        return;
    }

    const groupedItems = selectedItems.reduce((groups, item) => {
        const category = item.category || "Inne";
        if (!groups[category]) groups[category] = [];
        groups[category].push(item);
        return groups;
    }, {});

    preview.innerHTML = Object.entries(groupedItems).map(([category, items]) => `
        <div class="menu-day-group">
            <strong>${category}</strong>
            <ul>
                ${items.map(item => `<li>${item.name} <span>${Number(item.price).toFixed(2)} zł</span></li>`).join('')}
            </ul>
        </div>
    `).join('');
}

function publishComposedMenu() {
    const selectedItems = menuMode === "daily"
        ? parsedDailyMenu.map(menuItemFromParsedItem)
        : getLibraryItemsForCurrentRestaurant()
            .filter(item => composerSelectedIds.has(item.id))
            .map(menuItemFromLibraryItem);

    if (selectedItems.length === 0) {
        showToast(menuMode === "daily" ? "Przetwórz przynajmniej jedno danie." : "Zaznacz przynajmniej jedno danie.", "error");
        return;
    }

    Promise.all([
        db.collection("config").doc("current").update({ menu: selectedItems }),
        upsertRestaurant(restaurantName, {
            menuMode,
            lastMenu: selectedItems,
            lastOrderLimit: orderLimit
        })
    ])
        .then(() => showToast("Opublikowano menu dnia i zapisano je przy restauracji.", "success"))
        .catch(err => console.error("Error publishing menu:", err));
}

function renderMenu() {
    const menuList = document.getElementById('menu-list');
    if (!menuList) return;
    menuList.innerHTML = "";
    const orderingClosed = isOrderingClosed();
    const selectedItem = getSelectedMenuItem();

    if (dailyMenu.length === 0) {
        menuList.innerHTML = '<li class="menu-item">Menu nie jest jeszcze ustawione.</li>';
        return;
    }

    dailyMenu.forEach(item => {
        const li = document.createElement('li');
        li.className = orderingClosed ? 'menu-item is-disabled' : 'menu-item clickable';
        if (!orderingClosed && String(selectedItem?.id) === String(item.id)) li.classList.add('selected');
        li.setAttribute('data-id', String(item.id));
        if (!orderingClosed) {
            li.onclick = () => selectMenuItem(item.id, item.name, item.price);
        }

        const name = document.createElement('span');
        name.innerHTML = `${item.name}${item.category ? `<small>${item.category}</small>` : ""}`;

        const price = document.createElement('span');
        price.className = 'menu-price';
        price.innerText = `${item.price.toFixed(2)} zł`;

        li.append(name, price);
        menuList.appendChild(li);
    });

    renderOrderPreview();
}

function selectMenuItem(id, name, price) {
    if (isOrderingClosed()) return;

    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('selected'));
    const selectedEl = [...document.querySelectorAll('.menu-item')].find(el => el.dataset.id === String(id));
    if (selectedEl) selectedEl.classList.add('selected');

    const display = document.getElementById('selected-item-display');
    const inputId = document.getElementById('item-select-id');

    if (display && inputId) {
        display.innerText = `${name} (${price.toFixed(2)} zł)`;
        inputId.value = String(id);
    }

    renderOrderPreview();
}

function updateOrderAvailability() {
    const closed = isOrderingClosed();
    const submitButton = document.getElementById('submit-order-btn');
    const selectedItemInput = document.getElementById('item-select-id');
    const selectedItemDisplay = document.getElementById('selected-item-display');

    document.body.classList.toggle('orders-closed', closed);

    if (submitButton) {
        submitButton.disabled = closed;
        submitButton.innerText = closed ? "Zamówienia zamknięte" : "Zamawiam";
    }

    if (closed) {
        if (selectedItemInput) selectedItemInput.value = "";
        if (selectedItemDisplay) selectedItemDisplay.innerText = `Zamówienia zamknięte o ${orderLimit}`;
    }
    renderOrderPreview();
}

function addOrder() {
    const userNameInput = document.getElementById('user-name').value.trim();
    const itemId = document.getElementById('item-select-id').value;
    const noteInput = document.getElementById('order-note').value.trim();

    if (userNameInput === "" || !itemId) {
        showToast("Wpisz imię i kliknij danie z menu.", "error");
        return;
    }

    if (isOrderingClosed()) {
        showToast(`Czas na składanie zamówień minął o ${orderLimit}.`, "error");
        updateOrderAvailability();
        renderMenu();
        return;
    }

    const selectedItem = dailyMenu.find(m => String(m.id) === String(itemId));
    if (!selectedItem) {
        showToast("Wybrane danie nie jest już dostępne.", "error");
        return;
    }

    localStorage.setItem(USER_NAME_STORAGE_KEY, userNameInput);

    db.collection("orders").add({
        user: userNameInput,
        item: selectedItem,
        note: noteInput,
        paid: false,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        document.getElementById('item-select-id').value = "";
        document.getElementById('selected-item-display').innerText = "Kliknij danie z menu";
        renderOrderPreview();
        document.getElementById('order-note').value = "";
        document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('selected'));
        switchTab('summary-tab');
        showToast("Zamówienie dodane do listy.", "success");
    });
}

function togglePaid(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (order) {
        db.collection("orders").doc(orderId).update({ paid: !order.paid });
    }
}

function deleteOrder(orderId) {
    if (!isAdminLoggedIn()) {
        showToast("Tylko administrator może usuwać zamówienia.", "error");
        return;
    }

    if (confirm("Usunąć to zamówienie?")) {
        db.collection("orders").doc(orderId).delete();
    }
}

async function clearAllOrders() {
    if (!isAdminLoggedIn()) {
        showToast("Tylko administrator może resetować listę.", "error");
        return;
    }

    if (confirm("Wyczyścić dzisiejszą listę bez zapisywania do historii?")) {
        const snapshot = await db.collection("orders").get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }
}

async function archiveDay() {
    if (!isAdminLoggedIn()) {
        showToast("Tylko administrator może zakończyć dzień.", "error");
        return;
    }

    if (orders.length === 0) {
        showToast("Nie ma żadnych zamówień do zapisania.", "info");
        return;
    }

    if (confirm("Zakończyć dzień i zapisać zamówienia do historii?")) {
        const total = document.getElementById('total-price-value').innerText;

        await db.collection("history").add({
            date: new Date().toLocaleDateString('pl-PL', dateOptions),
            restaurant: restaurantName,
            orders: orders,
            total: total,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        const snapshot = await db.collection("orders").get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        showToast("Dzień zapisany w historii.", "success");
    }
}

function deleteHistoryEntry(historyId) {
    if (!isAdminLoggedIn()) {
        showToast("Tylko administrator może usuwać historię.", "error");
        return;
    }

    if (confirm("Usunąć ten wpis z historii?")) {
        db.collection("history").doc(historyId).delete()
            .then(() => showToast("Usunięto wpis z historii.", "success"))
            .catch(err => console.error("Error deleting history entry:", err));
    }
}

async function clearHistory() {
    if (!isAdminLoggedIn()) {
        showToast("Tylko administrator może czyścić historię.", "error");
        return;
    }

    if (history.length === 0) {
        showToast("Historia jest już pusta.", "info");
        return;
    }

    if (confirm("Usunąć całą historię zamówień?")) {
        const snapshot = await db.collection("history").get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        showToast("Wyczyszczono historię zamówień.", "success");
    }
}

function renderOrders() {
    const tbody = document.getElementById('orders-body');
    const deliveryFeeInput = document.getElementById('delivery-fee');
    const deliveryCalcInfo = document.getElementById('delivery-calc-info');
    const ordersCount = document.getElementById('orders-count');

    if (ordersCount) ordersCount.innerText = orders.length;
    if (!tbody) return;

    tbody.innerHTML = "";
    let itemsPrice = 0;

    if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">Brak zamówień. Pierwsze dodasz w zakładce Zamów.</td></tr>';
    }

    const deliveryFeeTotal = parseFloat(deliveryFeeInput.value) || 0;
    const uniqueUsers = [...new Set(orders.map(o => o.user))].length;
    const deliveryPerPerson = uniqueUsers > 0 ? (deliveryFeeTotal / uniqueUsers) : 0;

    if (deliveryFeeTotal > 0) {
        deliveryCalcInfo.innerText = `Dostawa: ${deliveryFeeTotal.toFixed(2)} zł / ${uniqueUsers} os. = +${deliveryPerPerson.toFixed(2)} zł/os.`;
    } else {
        deliveryCalcInfo.innerText = "";
    }

    const userDeliveryPaid = {};

    orders.forEach(order => {
        const tr = document.createElement('tr');
        if (order.paid) tr.className = 'paid-row';

        let orderDeliveryPart = 0;
        if (!userDeliveryPaid[order.user]) {
            orderDeliveryPart = deliveryPerPerson;
            userDeliveryPaid[order.user] = true;
        }

        const priceWithDelivery = order.item.price + orderDeliveryPart;

        tr.innerHTML = `
            <td data-label="Kto"><strong>${order.user}</strong></td>
            <td data-label="Co">
                ${order.item.name}
                ${order.note ? `<span class="note-text">${order.note}</span>` : ""}
            </td>
            <td data-label="Cena">${priceWithDelivery.toFixed(2)} zł</td>
            <td data-label="Zapł.">
                <input type="checkbox" ${order.paid ? 'checked' : ''} onchange="togglePaid('${order.id}')">
            </td>
            <td data-label="Akcje">${isAdminLoggedIn() ? `<button class="btn-danger btn-small" onclick="deleteOrder('${order.id}')">Usuń</button>` : ""}</td>
        `;

        tbody.appendChild(tr);
        itemsPrice += order.item.price;
    });

    const finalTotal = itemsPrice + deliveryFeeTotal;
    const totalPriceElement = document.getElementById('total-price-value');
    if (totalPriceElement) totalPriceElement.innerText = finalTotal.toFixed(2);
}

function renderHistory() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;

    if (history.length === 0) {
        historyList.innerHTML = '<p class="note-text">Brak archiwalnych zamówień.</p>';
        return;
    }

    historyList.innerHTML = "";
    history.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'history-item';

        const header = document.createElement('div');
        header.className = 'history-header';
        header.innerHTML = `
            <span>${entry.date} - ${entry.restaurant}</span>
            <span>Suma: ${entry.total} zł</span>
            ${isAdminLoggedIn() ? `<button class="btn-danger btn-small" onclick="deleteHistoryEntry('${entry.id}')">Usuń wpis</button>` : ""}
        `;

        const list = document.createElement('ul');
        list.className = 'history-orders';

        entry.orders.forEach(order => {
            const li = document.createElement('li');
            li.className = 'history-order-row';

            const label = document.createElement('span');
            label.innerHTML = `<strong>${order.user}</strong>: ${order.item.name} ${order.note ? `(${order.note})` : ''}`;

            const button = document.createElement('button');
            button.className = 'btn-small';
            button.innerText = 'Ponów';
            button.onclick = () => reorder(order.user, order.item.id, order.note || '');

            li.append(label, button);
            list.appendChild(li);
        });

        div.append(header, list);
        historyList.appendChild(div);
    });
}

function reorder(user, itemId, note) {
    const item = dailyMenu.find(menuItem => String(menuItem.id) === String(itemId));
    document.getElementById('user-name').value = user;
    document.getElementById('order-note').value = note;
    switchTab('orders-tab');

    if (item) {
        selectMenuItem(item.id, item.name, item.price);
    } else {
        document.getElementById('item-select-id').value = "";
        document.getElementById('selected-item-display').innerText = "Tego dania nie ma w dzisiejszym menu";
    }
}

initRememberedUserName();
initApp();
updateAdminUI();

setInterval(() => {
    renderOrderLimitInfo();
    renderDaySummary();
    renderMenu();
    updateOrderAvailability();
}, 30000);
