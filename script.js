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

function initApp() {
    db.collection("config").doc("current").onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            restaurantName = data.restaurantName || "Bistro pod Pijanym Ptakiem";
            dailyMenu = data.menu || [];
            orderLimit = data.orderLimit || "";

            renderRestaurantName();
            renderMenu();
            renderAdminMenu();
            renderOrderLimitInfo();
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
    });

    db.collection("profiles").onSnapshot((snapshot) => {
        profiles = {};
        snapshot.docs.forEach(doc => {
            profiles[doc.id] = doc.data();
        });
        renderProfileList();
    });
}

function switchTab(tabId) {
    if (tabId === 'admin-tab') {
        const isAdmin = localStorage.getItem('ptakIsAdmin') === 'true';

        if (!isAdmin) {
            const pass = prompt("Podaj hasło administratora:");
            if (pass === "ptak123") {
                localStorage.setItem('ptakIsAdmin', 'true');
            } else {
                if (pass !== null) alert("Błędne hasło.");
                return;
            }
        }
    }

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    const activeBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    const activeContent = document.getElementById(tabId);
    if (activeContent) activeContent.classList.add('active');

    if (tabId === 'admin-tab') {
        document.getElementById('admin-restaurant-name').value = restaurantName;
        document.getElementById('admin-order-limit').value = orderLimit;
        renderProfileList();
    }
}

function logoutAdmin() {
    localStorage.removeItem('ptakIsAdmin');
    alert("Wylogowano z panelu administratora.");
    switchTab('orders-tab');
}

function updateOrderLimit() {
    const limitInput = document.getElementById('admin-order-limit').value;
    db.collection("config").doc("current").update({ orderLimit: limitInput })
        .then(() => alert("Zaktualizowano limit czasu."))
        .catch(err => console.error("Error updating limit:", err));
}

function renderOrderLimitInfo() {
    const infoContainer = document.getElementById('order-limit-display');
    if (!infoContainer) return;

    infoContainer.innerText = orderLimit ? `Zamówienia do ${orderLimit}` : "";
}

function updateRestaurantName() {
    const newName = document.getElementById('admin-restaurant-name').value.trim();
    if (newName !== "") {
        db.collection("config").doc("current").update({ restaurantName: newName })
            .then(() => alert("Zaktualizowano nazwę restauracji."))
            .catch(err => console.error("Error updating name:", err));
    }
}

function renderRestaurantName() {
    document.getElementById('restaurant-name').innerText = restaurantName;
}

function saveAsProfile() {
    if (dailyMenu.length === 0) {
        alert("Menu jest puste. Dodaj najpierw dania.");
        return;
    }

    const profileName = prompt("Podaj nazwę dla tego szablonu:", restaurantName);
    if (profileName) {
        db.collection("profiles").doc(profileName).set({
            name: restaurantName,
            menu: dailyMenu
        }).then(() => alert(`Zapisano szablon: ${profileName}`));
    }
}

function loadProfile() {
    const profileName = document.getElementById('profile-select').value;
    if (!profileName) {
        alert("Wybierz szablon z listy.");
        return;
    }

    if (confirm(`Wczytać szablon "${profileName}"? Obecne menu zostanie zastąpione.`)) {
        const profile = profiles[profileName];
        db.collection("config").doc("current").update({
            restaurantName: profile.name,
            menu: profile.menu
        }).then(() => alert(`Wczytano: ${profileName}`));
    }
}

function deleteProfile() {
    const profileName = document.getElementById('profile-select').value;
    if (!profileName) return;

    if (confirm(`Usunąć szablon "${profileName}"?`)) {
        db.collection("profiles").doc(profileName).delete()
            .then(() => alert("Usunięto szablon."));
    }
}

function renderProfileList() {
    const select = document.getElementById('profile-select');
    if (!select) return;
    select.innerHTML = '<option value="">Wybierz zapisany szablon</option>';

    Object.keys(profiles).forEach(pName => {
        const opt = document.createElement('option');
        opt.value = pName;
        opt.innerText = pName;
        select.appendChild(opt);
    });
}

function addMenuItem() {
    const nameInput = document.getElementById('admin-item-name').value.trim();
    const priceInput = parseFloat(document.getElementById('admin-item-price').value);

    if (nameInput === "" || isNaN(priceInput)) {
        alert("Podaj poprawną nazwę i cenę, np. 25.50.");
        return;
    }

    const newItem = {
        id: Date.now(),
        name: nameInput,
        price: priceInput
    };

    db.collection("config").doc("current").update({ menu: [...dailyMenu, newItem] })
        .then(() => {
            document.getElementById('admin-item-name').value = "";
            document.getElementById('admin-item-price').value = "";
        });
}

function deleteMenuItem(id) {
    if (confirm("Usunąć tę pozycję z menu?")) {
        const updatedMenu = dailyMenu.filter(item => item.id !== id);
        db.collection("config").doc("current").update({ menu: updatedMenu });
    }
}

function renderAdminMenu() {
    const adminMenuList = document.getElementById('admin-menu-list');
    if (!adminMenuList) return;
    adminMenuList.innerHTML = "";

    if (dailyMenu.length === 0) {
        adminMenuList.innerHTML = '<li class="menu-item">Brak pozycji w menu.</li>';
        return;
    }

    dailyMenu.forEach(item => {
        const li = document.createElement('li');
        li.className = 'menu-item';

        const label = document.createElement('span');
        label.innerHTML = `${item.name} <span class="menu-price">${item.price.toFixed(2)} zł</span>`;

        const button = document.createElement('button');
        button.className = 'btn-danger btn-small';
        button.innerText = 'Usuń';
        button.onclick = () => deleteMenuItem(item.id);

        li.append(label, button);
        adminMenuList.appendChild(li);
    });
}

function renderMenu() {
    const menuList = document.getElementById('menu-list');
    if (!menuList) return;
    menuList.innerHTML = "";

    if (dailyMenu.length === 0) {
        menuList.innerHTML = '<li class="menu-item">Menu nie jest jeszcze ustawione.</li>';
        return;
    }

    dailyMenu.forEach(item => {
        const li = document.createElement('li');
        li.className = 'menu-item clickable';
        li.setAttribute('data-id', item.id);
        li.onclick = () => selectMenuItem(item.id, item.name, item.price);

        const name = document.createElement('span');
        name.innerText = item.name;

        const price = document.createElement('span');
        price.className = 'menu-price';
        price.innerText = `${item.price.toFixed(2)} zł`;

        li.append(name, price);
        menuList.appendChild(li);
    });
}

function selectMenuItem(id, name, price) {
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('selected'));
    const selectedEl = document.querySelector(`.menu-item[data-id="${id}"]`);
    if (selectedEl) selectedEl.classList.add('selected');

    const display = document.getElementById('selected-item-display');
    const inputId = document.getElementById('item-select-id');

    if (display && inputId) {
        display.innerText = `${name} (${price.toFixed(2)} zł)`;
        inputId.value = id;
    }
}

function addOrder() {
    const userNameInput = document.getElementById('user-name').value.trim();
    const itemId = parseInt(document.getElementById('item-select-id').value);
    const noteInput = document.getElementById('order-note').value.trim();

    if (userNameInput === "" || isNaN(itemId)) {
        alert("Wpisz imię i kliknij danie z menu.");
        return;
    }

    if (orderLimit) {
        const now = new Date();
        const [limitHours, limitMinutes] = orderLimit.split(':').map(Number);
        const limitDate = new Date();
        limitDate.setHours(limitHours, limitMinutes, 0, 0);

        if (now > limitDate) {
            alert(`Czas na składanie zamówień minął o ${orderLimit}.`);
            return;
        }
    }

    const selectedItem = dailyMenu.find(m => m.id === itemId);
    if (!selectedItem) {
        alert("Wybrane danie nie jest już dostępne.");
        return;
    }

    db.collection("orders").add({
        user: userNameInput,
        item: selectedItem,
        note: noteInput,
        paid: false,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        document.getElementById('item-select-id').value = "";
        document.getElementById('selected-item-display').innerText = "Kliknij danie z menu";
        document.getElementById('order-note').value = "";
        document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('selected'));
        switchTab('summary-tab');
    });
}

function togglePaid(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (order) {
        db.collection("orders").doc(orderId).update({ paid: !order.paid });
    }
}

function deleteOrder(orderId) {
    if (confirm("Usunąć to zamówienie?")) {
        db.collection("orders").doc(orderId).delete();
    }
}

async function clearAllOrders() {
    if (confirm("Wyczyścić dzisiejszą listę bez zapisywania do historii?")) {
        const snapshot = await db.collection("orders").get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }
}

async function archiveDay() {
    if (orders.length === 0) {
        alert("Nie ma żadnych zamówień do zapisania.");
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

        alert("Dzień zapisany w historii.");
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
            <td><strong>${order.user}</strong></td>
            <td>
                ${order.item.name}
                ${order.note ? `<span class="note-text">${order.note}</span>` : ""}
            </td>
            <td>${priceWithDelivery.toFixed(2)} zł</td>
            <td>
                <input type="checkbox" ${order.paid ? 'checked' : ''} onchange="togglePaid('${order.id}')">
            </td>
            <td><button class="btn-danger btn-small" onclick="deleteOrder('${order.id}')">Usuń</button></td>
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
        header.innerHTML = `<span>${entry.date} - ${entry.restaurant}</span><span>Suma: ${entry.total} zł</span>`;

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
    const item = dailyMenu.find(menuItem => menuItem.id === itemId);
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

initApp();
