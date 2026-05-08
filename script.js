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
let activeAdminPanel = "today";
let parsedDailyMenu = [];
let fixedMenuDraft = [];
let fixedMenuDraftSaved = false;
let savedFixedMenuRestaurantId = "";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "ptak123";
const USER_NAME_STORAGE_KEY = "ptakUserName";
const ADMIN_PANEL_STORAGE_KEY = "ptakAdminPanel";
const AUTO_ARCHIVE_HOUR = 18;
const HISTORY_RETENTION_DAYS = 7;
let autoArchiveCheckInProgress = false;

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

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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
        description: item.description || "",
        price: item.price,
        category: item.category || "Inne"
    };
}

function menuItemFromParsedItem(item, index) {
    return {
        id: `daily-${Date.now()}-${index}`,
        name: item.name,
        description: item.description || "",
        price: item.price,
        category: item.category || "Menu dnia",
        source: "daily"
    };
}

function menuItemFromFixedDraftItem(item, index) {
    return {
        id: item.id || `fixed-${Date.now()}-${index}`,
        name: item.name,
        description: item.description || "",
        price: Number(item.price),
        category: item.category || "Menu stałe",
        source: "fixed"
    };
}

function getAdminRestaurantName() {
    return document.getElementById('admin-restaurant-name')?.value.trim() || restaurantName;
}

function getFixedMenuEditorRestaurantName() {
    return document.getElementById('fixed-menu-restaurant-name')?.value.trim() || getAdminRestaurantName();
}

function getArchiveDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getSavedFixedMenuRestaurants() {
    return restaurants
        .filter(restaurant => Array.isArray(restaurant.fixedMenu) && restaurant.fixedMenu.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

function getCurrentFixedMenuRestaurantId() {
    const name = getAdminRestaurantName();
    const existing = restaurants.find(restaurant => restaurant.name === name);
    return existing?.id || restaurantDocId(name);
}

function isFixedMenuReadyToPublish() {
    return menuMode !== "fixed" || (
        fixedMenuDraft.length > 0 &&
        fixedMenuDraftSaved &&
        savedFixedMenuRestaurantId === getCurrentFixedMenuRestaurantId()
    );
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
            renderSavedFixedMenuList();
            renderFixedMenuControls();
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
        maybeAutoArchiveOrders();
    });

    db.collection("history").orderBy("timestamp", "desc").limit(10).onSnapshot((snapshot) => {
        history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderHistory();
        renderRestaurantSuggestions();
    });

    pruneOldHistoryEntries();

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
        renderSavedFixedMenuList();
        renderMenuMode();
        renderMenuDayPreview();
        renderFixedMenuControls();
    });

    db.collection("dishLibrary").onSnapshot((snapshot) => {
        libraryItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        syncComposerSelectionFromMenu();
        renderAdminMenu();
        renderCategoryFilter();
        renderMenuDayPreview();
        renderRestaurantSuggestions();
        renderFixedMenuControls();
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
        renderSavedFixedMenuList();
        renderMenuMode();
        renderCategoryFilter();
        renderAdminMenu();
        renderMenuDayPreview();
        renderFixedMenuControls();
        renderAdminMenuStatus();
        switchAdminPanel(activeAdminPanel);
        updateAdminUI();
    }
}

function switchAdminPanel(panelId) {
    const validPanel = ["today", "fixed"].includes(panelId) ? panelId : "today";
    activeAdminPanel = validPanel;
    localStorage.setItem(ADMIN_PANEL_STORAGE_KEY, validPanel);

    if (validPanel === "fixed") {
        const editorNameInput = document.getElementById('fixed-menu-restaurant-name');
        if (editorNameInput && !editorNameInput.value.trim()) {
            editorNameInput.value = getAdminRestaurantName();
        }
    }

    document.querySelectorAll('.admin-workflow-tab').forEach(button => {
        button.classList.toggle('active', button.dataset.adminPanel === validPanel);
    });

    document.querySelectorAll('.admin-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `admin-panel-${validPanel}`);
    });

    renderMenuMode();
    renderMenuDayPreview();
    renderFixedMenuControls();
    renderAdminMenuStatus();
}

function initAdminPanelPreference() {
    const savedPanel = localStorage.getItem(ADMIN_PANEL_STORAGE_KEY);
    if (["today", "fixed"].includes(savedPanel)) {
        activeAdminPanel = savedPanel;
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
            renderFixedMenuControls();
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
    if (menuMode === "daily") {
        parsedDailyMenu = [];
        const dailyInput = document.getElementById('daily-menu-input');
        if (dailyInput) dailyInput.value = "";
    } else {
        fixedMenuDraft = [];
        fixedMenuDraftSaved = false;
        savedFixedMenuRestaurantId = "";
        const fixedInput = document.getElementById('fixed-menu-input');
        if (fixedInput) fixedInput.value = "";
    }

    composerSelectedIds.clear();
    renderAdminMenu();
    renderMenuDayPreview();
    renderFixedMenuControls();
}

function markFixedMenuDraftUnsaved() {
    fixedMenuDraftSaved = false;
    savedFixedMenuRestaurantId = "";
    renderFixedMenuControls();
}

function renderSavedFixedMenuList() {
    const selects = [
        document.getElementById('saved-fixed-menu-select'),
        document.getElementById('fixed-editor-menu-select')
    ].filter(Boolean);
    if (selects.length === 0) return;

    const currentValue = selects.find(select => select.value)?.value || "";
    const fixedMenus = getSavedFixedMenuRestaurants();

    selects.forEach(select => {
        select.innerHTML = '<option value="">Wybierz zapisane menu</option>';
        fixedMenus.forEach(restaurant => {
            const option = document.createElement('option');
            option.value = restaurant.id;
            option.innerText = restaurant.name;
            select.appendChild(option);
        });

        select.value = fixedMenus.some(restaurant => restaurant.id === currentValue)
            ? currentValue
            : "";
    });

    renderFixedMenuControls();
}

function syncSavedFixedMenuSelects(sourceId) {
    const source = document.getElementById(sourceId);
    if (!source) return;

    ['saved-fixed-menu-select', 'fixed-editor-menu-select'].forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select && select !== source) select.value = source.value;
    });
}

function renderFixedMenuControls() {
    const publishButton = document.getElementById('publish-menu-button');
    const saveButton = document.getElementById('save-fixed-menu-button');
    const loadButton = document.getElementById('load-fixed-menu-button');
    const deleteButton = document.getElementById('delete-fixed-menu-button');
    const savedSelect = document.getElementById('saved-fixed-menu-select');
    const editorSelect = document.getElementById('fixed-editor-menu-select');
    const fixedInput = document.getElementById('fixed-menu-input');
    const selectedFixedMenuId = savedSelect?.value || editorSelect?.value || "";

    if (publishButton) {
        const publishDisabled = menuMode === "fixed" && !isFixedMenuReadyToPublish();
        publishButton.disabled = publishDisabled;
        publishButton.title = publishDisabled ? "Najpierw zapisz stałe menu." : "";
    }

    if (saveButton) {
        const hasDraftSource = fixedMenuDraft.length > 0 || Boolean(fixedInput?.value.trim());
        saveButton.disabled = !hasDraftSource;
    }

    if (loadButton) {
        loadButton.disabled = !selectedFixedMenuId;
    }

    if (deleteButton) {
        deleteButton.disabled = !selectedFixedMenuId;
    }

    renderAdminMenuStatus();
}

function renderAdminMenuStatus() {
    const status = document.getElementById('admin-menu-status');
    if (!status) return;

    const itemCount = menuMode === "daily" ? parsedDailyMenu.length : fixedMenuDraft.length;
    let text = "";
    let state = "info";

    if (menuMode === "daily") {
        if (itemCount === 0) {
            text = "Menu dzienne nie jest jeszcze przetworzone.";
            state = "warning";
        } else {
            text = `Menu dzienne gotowe do publikacji · ${itemCount} pozycji.`;
            state = "success";
        }
    } else if (itemCount === 0) {
        text = "Stałe menu nie jest jeszcze wczytane ani przetworzone.";
        state = "warning";
    } else if (!isFixedMenuReadyToPublish()) {
        text = `Stałe menu zmienione · ${itemCount} pozycji · zapisz przed publikacją.`;
        state = "warning";
    } else {
        text = `Stałe menu zapisane · ${itemCount} pozycji · gotowe do publikacji.`;
        state = "success";
    }

    status.innerText = text;
    status.className = `admin-menu-status status-${state}`;
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
    renderFixedMenuControls();
    renderAdminMenuStatus();
}

function renderMenuMode() {
    document.querySelectorAll('input[name="menu-mode"]').forEach(input => {
        input.checked = input.value === menuMode;
    });

    document.querySelectorAll('.fixed-source-panel').forEach(panel => {
        panel.classList.toggle('is-hidden', menuMode !== "fixed");
    });

    document.querySelectorAll('.daily-source-panel').forEach(panel => {
        panel.classList.toggle('is-hidden', menuMode !== "daily");
    });

    renderFixedMenuControls();
    renderAdminMenuStatus();
}

function parseDailyMenuLine(line, category) {
    const cleanedLine = line.trim();
    if (!cleanedLine) return null;

    const match = cleanedLine.match(/^(.+?)(?:\s*[-–—:]\s*|\s+)(\d+(?:[,.]\d{1,2})?)\s*(?:zł|zl|pln)?$/i);
    if (!match) {
        return { error: `Nie rozpoznano ceny: ${cleanedLine}` };
    }

    const parsedName = parseMenuNameWithDescription(match[1].trim());
    const name = parsedName.name;
    const price = Number(match[2].replace(',', '.'));

    if (!name || Number.isNaN(price)) {
        return { error: `Nie rozpoznano pozycji: ${cleanedLine}` };
    }

    return {
        name,
        description: parsedName.description,
        price,
        category
    };
}

function parseMenuNameWithDescription(rawName) {
    const descriptionMatch = rawName.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (!descriptionMatch) {
        return {
            name: rawName,
            description: ""
        };
    }

    return {
        name: descriptionMatch[1].trim(),
        description: descriptionMatch[2].trim()
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

function parseFixedMenu(silent = false) {
    const input = document.getElementById('fixed-menu-input');
    const errorsContainer = document.getElementById('fixed-menu-errors');
    const category = "Menu stałe";
    const lines = (input?.value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    if (lines.length === 0) {
        fixedMenuDraft = [];
        fixedMenuDraftSaved = false;
        savedFixedMenuRestaurantId = "";
        if (errorsContainer) errorsContainer.classList.add('is-hidden');
        renderMenuDayPreview();
        renderFixedMenuControls();
        if (!silent) showToast("Wklej przynajmniej jedną pozycję stałego menu.", "info");
        return false;
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

    fixedMenuDraft = parsedItems;
    fixedMenuDraftSaved = false;
    savedFixedMenuRestaurantId = "";

    if (errorsContainer) {
        errorsContainer.innerHTML = errors.map(error => `<div>${error}</div>`).join('');
        errorsContainer.classList.toggle('is-hidden', errors.length === 0);
    }

    renderMenuDayPreview();
    renderFixedMenuControls();

    if (!silent) {
        if (parsedItems.length > 0) {
            showToast(`Przetworzono ${parsedItems.length} pozycji stałego menu.`, "success");
        } else {
            showToast("Nie udało się rozpoznać żadnej pozycji.", "error");
        }
    }

    return parsedItems.length > 0;
}

function saveFixedMenu() {
    const name = getFixedMenuEditorRestaurantName();
    const limitInput = document.getElementById('admin-order-limit')?.value || orderLimit;

    if (!name) {
        showToast("Podaj nazwę restauracji.", "error");
        return;
    }

    if (!parseFixedMenu(true)) {
        showToast("Wklej i przetwórz przynajmniej jedno danie stałego menu.", "error");
        return;
    }

    const selectedItems = fixedMenuDraft.map(menuItemFromFixedDraftItem);

    upsertRestaurant(name, {
        menuMode: "fixed",
        fixedMenu: selectedItems,
        lastMenu: selectedItems,
        lastOrderLimit: limitInput
    })
        .then(() => {
            const savedRestaurant = restaurants.find(restaurant => restaurant.name === name);
            fixedMenuDraft = selectedItems;
            fixedMenuDraftSaved = true;
            savedFixedMenuRestaurantId = savedRestaurant?.id || restaurantDocId(name);
            const editorNameInput = document.getElementById('fixed-menu-restaurant-name');
            if (editorNameInput) editorNameInput.value = name;
            renderSavedFixedMenuList();
            renderMenuDayPreview();
            renderFixedMenuControls();
            showToast("Zapisano stałe menu restauracji. Możesz je teraz opublikować.", "success");
        })
        .catch(err => console.error("Error saving fixed menu:", err));
}

function loadSelectedFixedMenu(sourceId = "saved-fixed-menu-select") {
    const select = document.getElementById(sourceId);
    const selectedRestaurant = restaurants.find(restaurant => restaurant.id === select?.value);

    if (!selectedRestaurant?.fixedMenu?.length) {
        showToast("Wybierz zapisane stałe menu.", "error");
        return;
    }

    const restaurantInput = document.getElementById('admin-restaurant-name');
    const editorNameInput = document.getElementById('fixed-menu-restaurant-name');
    const limitInput = document.getElementById('admin-order-limit');
    const fixedInput = document.getElementById('fixed-menu-input');

    menuMode = "fixed";
    fixedMenuDraft = selectedRestaurant.fixedMenu;
    fixedMenuDraftSaved = true;
    savedFixedMenuRestaurantId = selectedRestaurant.id;

    if (restaurantInput) restaurantInput.value = selectedRestaurant.name;
    if (editorNameInput) editorNameInput.value = selectedRestaurant.name;
    if (selectedRestaurant.lastOrderLimit && limitInput) limitInput.value = selectedRestaurant.lastOrderLimit;
    if (fixedInput) {
        fixedInput.value = selectedRestaurant.fixedMenu
            .map(item => `${item.name}${item.description ? ` (${item.description})` : ""} - ${Number(item.price).toFixed(2)}`)
            .join('\n');
    }

    syncSavedFixedMenuSelects(select.id);
    renderMenuMode();
    renderMenuDayPreview();
    renderFixedMenuControls();
    showToast("Wczytano stałe menu do kompozytora.", "success");
}

function deleteSelectedFixedMenu(sourceId = "saved-fixed-menu-select") {
    const select = document.getElementById(sourceId);
    const selectedRestaurant = restaurants.find(restaurant => restaurant.id === select?.value);

    if (!selectedRestaurant?.fixedMenu?.length) {
        showToast("Wybierz zapisane stałe menu do usunięcia.", "error");
        return;
    }

    if (!confirm(`Usunąć zapisane stałe menu restauracji ${selectedRestaurant.name}?`)) return;

    db.collection("restaurants").doc(selectedRestaurant.id).set({
        fixedMenu: firebase.firestore.FieldValue.delete(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
        .then(() => {
            restaurants = restaurants.map(restaurant => restaurant.id === selectedRestaurant.id
                ? { ...restaurant, fixedMenu: [] }
                : restaurant
            );

            if (savedFixedMenuRestaurantId === selectedRestaurant.id) {
                fixedMenuDraft = [];
                fixedMenuDraftSaved = false;
                savedFixedMenuRestaurantId = "";
                const fixedInput = document.getElementById('fixed-menu-input');
                if (fixedInput) fixedInput.value = "";
                renderMenuDayPreview();
            }

            if (select) select.value = "";
            renderSavedFixedMenuList();
            renderFixedMenuControls();
            showToast("Usunięto zapisane stałe menu.", "success");
        })
        .catch(err => console.error("Error deleting fixed menu:", err));
}

function renderMenuDayPreview() {
    const preview = document.getElementById('menu-day-preview');
    if (!preview) return;

    const selectedItems = menuMode === "daily"
        ? parsedDailyMenu
        : fixedMenuDraft;

    if (selectedItems.length === 0) {
        preview.innerHTML = menuMode === "daily"
            ? '<p class="note-text">Wklej menu i kliknij Przetwórz menu.</p>'
            : '<p class="note-text">Wklej stałe menu i kliknij Przetwórz menu.</p>';
        renderAdminMenuStatus();
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
            <strong>${escapeHtml(category)}</strong>
            <ul>
                ${items.map(item => `
                    <li>
                        <div class="menu-day-main">
                            <strong>${escapeHtml(item.name)}</strong>
                            ${item.description ? `<small class="menu-day-description">${escapeHtml(item.description)}</small>` : ""}
                        </div>
                        <span>${Number(item.price).toFixed(2)} zł</span>
                    </li>
                `).join('')}
            </ul>
        </div>
    `).join('');
    renderAdminMenuStatus();
}

function publishComposedMenu() {
    const selectedItems = menuMode === "daily"
        ? parsedDailyMenu.map(menuItemFromParsedItem)
        : fixedMenuDraft.map(menuItemFromFixedDraftItem);

    if (selectedItems.length === 0) {
        showToast(menuMode === "daily" ? "Przetwórz przynajmniej jedno danie." : "Wklej i zapisz przynajmniej jedno danie stałego menu.", "error");
        return;
    }

    if (menuMode === "fixed" && !isFixedMenuReadyToPublish()) {
        showToast("Najpierw zapisz stałe menu, potem je opublikuj.", "error");
        return;
    }

    const publishedRestaurantName = menuMode === "fixed" ? getAdminRestaurantName() : restaurantName;
    const publishedOrderLimit = menuMode === "fixed"
        ? (document.getElementById('admin-order-limit')?.value || orderLimit)
        : orderLimit;
    const configUpdates = menuMode === "fixed"
        ? { restaurantName: publishedRestaurantName, menu: selectedItems, orderLimit: publishedOrderLimit }
        : { menu: selectedItems };
    const restaurantUpdates = {
        menuMode,
        lastMenu: selectedItems,
        lastOrderLimit: publishedOrderLimit
    };

    if (menuMode === "fixed") {
        restaurantUpdates.fixedMenu = selectedItems;
    }

    Promise.all([
        db.collection("config").doc("current").update(configUpdates),
        upsertRestaurant(publishedRestaurantName, restaurantUpdates)
    ])
        .then(() => showToast("Opublikowano menu i zapisano je przy restauracji.", "success"))
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
        const itemName = document.createElement('strong');
        itemName.innerText = item.name;
        name.appendChild(itemName);

        if (item.description) {
            const description = document.createElement('small');
            description.className = 'menu-item-description';
            description.innerText = item.description;
            name.appendChild(description);
        }

        if (item.category) {
            const category = document.createElement('small');
            category.innerText = item.category;
            name.appendChild(category);
        }

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
        const nextPaid = !order.paid;
        db.collection("orders").doc(orderId).update({ paid: nextPaid })
            .then(() => showToast(nextPaid ? "Oznaczono zamówienie jako opłacone." : "Odznaczono płatność zamówienia.", "success"))
            .catch(err => {
                console.error("Error toggling paid state:", err);
                showToast("Nie udało się zmienić statusu płatności.", "error");
            });
    }
}

function deleteOrder(orderId) {
    if (!isAdminLoggedIn()) {
        showToast("Tylko administrator może usuwać zamówienia.", "error");
        return;
    }

    if (confirm("Usunąć to zamówienie?")) {
        db.collection("orders").doc(orderId).delete()
            .then(() => showToast("Usunięto zamówienie z listy.", "success"))
            .catch(err => {
                console.error("Error deleting order:", err);
                showToast("Nie udało się usunąć zamówienia.", "error");
            });
    }
}

async function markAllOrdersPaid(paid) {
    if (!isAdminLoggedIn()) {
        showToast("Tylko administrator może zmieniać płatności zbiorczo.", "error");
        return;
    }

    const ordersToUpdate = orders.filter(order => Boolean(order.paid) !== paid);
    if (ordersToUpdate.length === 0) {
        showToast(paid ? "Wszystkie zamówienia są już opłacone." : "Nie ma opłaconych zamówień do odznaczenia.", "info");
        return;
    }

    const batch = db.batch();
    ordersToUpdate.forEach(order => {
        batch.update(db.collection("orders").doc(order.id), { paid });
    });

    try {
        await batch.commit();
        showToast(paid ? "Oznaczono wszystkie zamówienia jako opłacone." : "Odznaczono wszystkie płatności.", "success");
    } catch (err) {
        console.error("Error updating paid states:", err);
        showToast("Nie udało się zbiorczo zmienić płatności.", "error");
    }
}

async function clearAllOrders() {
    if (!isAdminLoggedIn()) {
        showToast("Tylko administrator może resetować listę.", "error");
        return;
    }

    if (orders.length === 0) {
        showToast("Lista zamówień jest już pusta.", "info");
        return;
    }

    if (confirm("Wyczyścić dzisiejszą listę bez zapisywania do historii?")) {
        const snapshot = await db.collection("orders").get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        showToast("Wyczyszczono dzisiejszą listę zamówień.", "success");
    }
}

async function archiveCurrentOrders({ automatic = false } = {}) {
    const archiveDateKey = getArchiveDateKey();

    if (orders.length === 0) {
        if (!automatic) showToast("Nie ma żadnych zamówień do zapisania.", "info");
        return false;
    }

    const configRef = db.collection("config").doc("current");
    const canArchive = await db.runTransaction(async transaction => {
        const configDoc = await transaction.get(configRef);
        const data = configDoc.exists ? configDoc.data() : {};

        if (automatic && data.lastAutoArchiveDate === archiveDateKey) {
            return false;
        }

        transaction.set(configRef, {
            lastAutoArchiveDate: archiveDateKey,
            lastArchiveAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return true;
    });

    if (!canArchive) return false;

    const financials = getOrderFinancialRows();
    const ordersSnapshot = await db.collection("orders").get();

    if (ordersSnapshot.empty) {
        return false;
    }

    await db.collection("history").add({
        date: new Date().toLocaleDateString('pl-PL', dateOptions),
        archiveDate: archiveDateKey,
        restaurant: restaurantName,
        orders: ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        total: financials.finalTotal.toFixed(2),
        remainingTotal: financials.remainingTotal.toFixed(2),
        paidTotal: financials.paidTotal.toFixed(2),
        autoArchived: automatic,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    const batch = db.batch();
    ordersSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    await pruneOldHistoryEntries();

    showToast(automatic ? "Zamówienia zostały automatycznie zarchiwizowane o 18:00." : "Dzień zapisany w historii.", "success");
    return true;
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

    if (!confirm("Zarchiwizować dzisiejsze zamówienia? Nie muszą być wszystkie opłacone.")) return;

    try {
        await archiveCurrentOrders({ automatic: false });
    } catch (err) {
        console.error("Error archiving day:", err);
        showToast("Nie udało się zarchiwizować dnia.", "error");
    }
}

async function maybeAutoArchiveOrders() {
    const now = new Date();
    if (!isAdminLoggedIn() || now.getHours() < AUTO_ARCHIVE_HOUR || autoArchiveCheckInProgress || orders.length === 0) return;

    autoArchiveCheckInProgress = true;
    try {
        await archiveCurrentOrders({ automatic: true });
    } catch (err) {
        console.error("Error auto-archiving orders:", err);
    } finally {
        autoArchiveCheckInProgress = false;
    }
}

async function pruneOldHistoryEntries() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_RETENTION_DAYS);

    try {
        const snapshot = await db.collection("history")
            .where("timestamp", "<", firebase.firestore.Timestamp.fromDate(cutoff))
            .get();

        if (snapshot.empty) return;

        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    } catch (err) {
        console.error("Error pruning old history entries:", err);
    }
}

function getOrderFinancialRows() {
    const deliveryFeeInput = document.getElementById('delivery-fee');
    const deliveryFeeTotal = parseFloat(deliveryFeeInput?.value) || 0;
    const uniqueUsers = [...new Set(orders.map(order => order.user))].length;
    const deliveryPerPerson = uniqueUsers > 0 ? (deliveryFeeTotal / uniqueUsers) : 0;
    const userDeliveryApplied = {};

    const rows = orders.map(order => {
        let deliveryPart = 0;
        if (!userDeliveryApplied[order.user]) {
            deliveryPart = deliveryPerPerson;
            userDeliveryApplied[order.user] = true;
        }

        const itemPrice = Number(order.item?.price) || 0;
        return {
            order,
            itemPrice,
            deliveryPart,
            priceWithDelivery: itemPrice + deliveryPart
        };
    });

    const itemsTotal = rows.reduce((sum, row) => sum + row.itemPrice, 0);
    const finalTotal = itemsTotal + deliveryFeeTotal;
    const paidTotal = rows.reduce((sum, row) => row.order.paid ? sum + row.priceWithDelivery : sum, 0);
    const remainingTotal = rows.reduce((sum, row) => row.order.paid ? sum : sum + row.priceWithDelivery, 0);

    return {
        rows,
        deliveryFeeTotal,
        uniqueUsers,
        deliveryPerPerson,
        finalTotal,
        paidTotal,
        remainingTotal
    };
}

function copyOrdersSummary() {
    if (orders.length === 0) {
        showToast("Nie ma zamówień do skopiowania.", "info");
        return;
    }

    const financials = getOrderFinancialRows();
    const lines = [
        `Zamówienia - ${restaurantName}`,
        ...financials.rows.map(({ order, priceWithDelivery }) => {
            const status = order.paid ? "opłacone" : "do zapłaty";
            const note = order.note ? ` (${order.note})` : "";
            return `${order.user}: ${order.item.name}${note} - ${priceWithDelivery.toFixed(2)} zł [${status}]`;
        }),
        `Do zapłaty: ${financials.remainingTotal.toFixed(2)} zł`,
        `Zapłacono: ${financials.paidTotal.toFixed(2)} zł`,
        `Suma: ${financials.finalTotal.toFixed(2)} zł`
    ];

    if (!navigator.clipboard) {
        showToast("Kopiowanie nie jest dostępne w tej przeglądarce.", "error");
        return;
    }

    navigator.clipboard.writeText(lines.join('\n'))
        .then(() => showToast("Skopiowano listę zamówień.", "success"))
        .catch(err => {
            console.error("Error copying orders summary:", err);
            showToast("Nie udało się skopiować listy.", "error");
        });
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
    const deliveryCalcInfo = document.getElementById('delivery-calc-info');
    const ordersCount = document.getElementById('orders-count');
    const summaryCards = document.getElementById('orders-summary-cards');

    if (ordersCount) ordersCount.innerText = orders.length;
    if (!tbody) return;

    tbody.innerHTML = "";
    const financials = getOrderFinancialRows();

    if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">Brak zamówień. Pierwsze dodasz w zakładce Zamów.</td></tr>';
    }

    if (financials.deliveryFeeTotal > 0) {
        deliveryCalcInfo.innerText = `Dostawa: ${financials.deliveryFeeTotal.toFixed(2)} zł / ${financials.uniqueUsers} os. = +${financials.deliveryPerPerson.toFixed(2)} zł/os.`;
    } else {
        deliveryCalcInfo.innerText = "";
    }

    if (summaryCards) {
        summaryCards.innerHTML = `
            <div class="orders-summary-card">
                <span>Zamówienia</span>
                <strong>${orders.length}</strong>
            </div>
            <div class="orders-summary-card">
                <span>Do zapłaty</span>
                <strong>${financials.remainingTotal.toFixed(2)} zł</strong>
            </div>
            <div class="orders-summary-card">
                <span>Zapłacono</span>
                <strong>${financials.paidTotal.toFixed(2)} zł</strong>
            </div>
            <div class="orders-summary-card">
                <span>Suma</span>
                <strong>${financials.finalTotal.toFixed(2)} zł</strong>
            </div>
        `;
    }

    financials.rows.forEach(({ order, deliveryPart, priceWithDelivery }) => {
        const tr = document.createElement('tr');
        if (order.paid) tr.className = 'paid-row';

        tr.innerHTML = `
            <td data-label="Kto"><strong>${escapeHtml(order.user)}</strong></td>
            <td data-label="Co">
                ${escapeHtml(order.item.name)}
                ${deliveryPart > 0 ? `<span class="note-text">Dostawa: +${deliveryPart.toFixed(2)} zł</span>` : ""}
                ${order.note ? `<span class="note-text">${escapeHtml(order.note)}</span>` : ""}
            </td>
            <td data-label="Cena">${priceWithDelivery.toFixed(2)} zł</td>
            <td data-label="Zapł.">
                <input type="checkbox" ${order.paid ? 'checked' : ''} onchange="togglePaid('${order.id}')">
            </td>
            <td data-label="Akcje">${isAdminLoggedIn() ? `<button class="btn-danger btn-small" onclick="deleteOrder('${order.id}')">Usuń</button>` : ""}</td>
        `;

        tbody.appendChild(tr);
    });

    const totalPriceElement = document.getElementById('total-price-value');
    const remainingPriceElement = document.getElementById('remaining-price-value');
    if (totalPriceElement) totalPriceElement.innerText = financials.finalTotal.toFixed(2);
    if (remainingPriceElement) remainingPriceElement.innerText = financials.remainingTotal.toFixed(2);
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
initAdminPanelPreference();
initApp();
updateAdminUI();

setInterval(() => {
    renderOrderLimitInfo();
    renderDaySummary();
    renderMenu();
    updateOrderAvailability();
    maybeAutoArchiveOrders();
}, 30000);
