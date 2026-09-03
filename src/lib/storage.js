// Storage. Ported from Ride the Wind's Backend/Store split
// (reference/ride-the-wind/src/lib/storage.js) — same seven-method Backend
// interface, same two implementations, same injected-dependency Store shape.
// Only the store names, keys, and domain methods differ.
import { validateRecipe } from "./recipe.js";

export const STORES = {
  RECIPES: "recipes",
  INSTANCES: "instances",
  OPEN_SET: "openSet",
  ALARM_THEMES: "alarmThemes",
  SOUNDS: "sounds",
  SETTINGS: "settings",
};
export const DB_NAME = "temperatura";
export const DB_VERSION = 1;

// Backend interface
//   get(store, key) -> value|undefined
//   getAll(store) -> value[]
//   getAllByIndex(store, indexName, value) -> value[]
//   put(store, value)            (value carries its own key)
//   putKV(store, key, value)     (explicit key, for settings)
//   delete(store, key)
//   deleteWhere(store, predicate)

// Secondary indexes, generalized (RTW's MemoryBackend hardcoded its one index
// to the one field it needed; here it's declared once and used by name).
const INDEXES = {
  [STORES.INSTANCES]: { recipeId: (v) => v.recipeId },
};

function keyFor(store, value) {
  if (store === STORES.OPEN_SET) return value.recipeId;
  return value.id;
}

export class MemoryBackend {
  constructor() {
    this.data = {};
    for (const name of Object.values(STORES)) this.data[name] = new Map();
  }
  async get(store, key) { return this.data[store].get(key); }
  async getAll(store) { return Array.from(this.data[store].values()); }
  async getAllByIndex(store, indexName, value) {
    const accessor = INDEXES[store]?.[indexName];
    if (!accessor) throw new Error(`No index "${indexName}" declared for store "${store}".`);
    return Array.from(this.data[store].values()).filter((v) => accessor(v) === value);
  }
  async put(store, value) {
    this.data[store].set(keyFor(store, value), value);
    return value;
  }
  async putKV(store, key, value) { this.data[store].set(key, value); return value; }
  async delete(store, key) { this.data[store].delete(key); }
  async deleteWhere(store, predicate) {
    for (const [k, v] of this.data[store]) { if (predicate(v)) this.data[store].delete(k); }
  }
}

export class IndexedDBBackend {
  constructor(idbFactory) {
    this.idb = idbFactory || (typeof indexedDB !== "undefined" ? indexedDB : null);
    if (!this.idb) throw new Error("IndexedDB unavailable in this environment.");
    this._dbPromise = null;
  }

  _open() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const req = this.idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.RECIPES))
          db.createObjectStore(STORES.RECIPES, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORES.INSTANCES)) {
          const instances = db.createObjectStore(STORES.INSTANCES, { keyPath: "id" });
          instances.createIndex("recipeId", "recipeId", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.OPEN_SET))
          db.createObjectStore(STORES.OPEN_SET, { keyPath: "recipeId" });
        if (!db.objectStoreNames.contains(STORES.ALARM_THEMES))
          db.createObjectStore(STORES.ALARM_THEMES, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORES.SOUNDS))
          db.createObjectStore(STORES.SOUNDS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORES.SETTINGS))
          db.createObjectStore(STORES.SETTINGS); // out-of-line keys
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  }

  async _tx(store, mode, fn) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      Promise.resolve(fn(os)).then((r) => (result = r));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  _req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  get(store, key) { return this._tx(store, "readonly", (os) => this._req(os.get(key))); }
  getAll(store) { return this._tx(store, "readonly", (os) => this._req(os.getAll())); }
  getAllByIndex(store, indexName, value) {
    return this._tx(store, "readonly", (os) => this._req(os.index(indexName).getAll(value)));
  }
  put(store, value) {
    return this._tx(store, "readwrite", (os) => this._req(os.put(value))).then(() => value);
  }
  putKV(store, key, value) {
    return this._tx(store, "readwrite", (os) => this._req(os.put(value, key))).then(() => value);
  }
  delete(store, key) { return this._tx(store, "readwrite", (os) => this._req(os.delete(key))); }
  async deleteWhere(store, predicate) {
    const all = await this.getAll(store);
    const victims = all.filter(predicate);
    await this._tx(store, "readwrite", (os) =>
      Promise.all(victims.map((v) => this._req(os.delete(keyFor(store, v)))))
    );
  }
}

function defaultUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class Store {
  /**
   * @param {object} deps
   * @param {Backend} deps.backend
   * @param {()=>string} [deps.uuid] - id generator, injectable for tests
   */
  constructor({ backend, uuid }) {
    this.b = backend;
    this.uuid = uuid || defaultUuid;
  }

  // ---- Recipes ----------------------------------------------------------

  async createRecipe(recipe) {
    const { valid, errors } = validateRecipe(recipe);
    if (!valid) throw new Error("Invalid recipe: " + errors.join(" "));
    const withId = { ...recipe, id: recipe.id || this.uuid() };
    return this.b.put(STORES.RECIPES, withId);
  }

  getRecipe(id) { return this.b.get(STORES.RECIPES, id); }
  listRecipes() { return this.b.getAll(STORES.RECIPES); }

  async updateRecipe(id, patch) {
    const existing = await this.getRecipe(id);
    if (!existing) throw new Error(`Recipe "${id}" not found.`);
    const updated = { ...existing, ...patch };
    const { valid, errors } = validateRecipe(updated);
    if (!valid) throw new Error("Invalid recipe: " + errors.join(" "));
    return this.b.put(STORES.RECIPES, updated);
  }

  // Deletes the recipe and every instance belonging to it. The spec's
  // "cannot delete a step with a running instance" rule is enforced by the
  // caller (recipe editing UI) checking listInstancesForRecipe first — this
  // is the unconditional cascade, same posture as RTW's deleteRoute.
  async deleteRecipe(id) {
    await this.b.deleteWhere(STORES.INSTANCES, (i) => i.recipeId === id);
    await this.b.delete(STORES.OPEN_SET, id);
    await this.b.delete(STORES.RECIPES, id);
  }

  // ---- Open set -----------------------------------------------------------
  // One row per open recipe (keyed by recipeId) rather than a single array
  // value, so opening/closing is a plain put/delete with no read-modify-write.

  openRecipe(recipeId) { return this.b.put(STORES.OPEN_SET, { recipeId, openedAt: Date.now() }); }
  async listOpenRecipeIds() { return (await this.b.getAll(STORES.OPEN_SET)).map((r) => r.recipeId); }

  // The spec's cascade: closing a recipe with running instances completes
  // them first. The confirmation dialog is a UI concern — this method does
  // the cascade unconditionally, same posture as RTW's deleteRoute.
  async closeRecipe(recipeId, now) {
    const instances = await this.listInstancesForRecipe(recipeId);
    for (const instance of instances) {
      if (instance.status !== "completed") {
        await this.b.put(STORES.INSTANCES, { ...instance, status: "completed", completedAt: now });
      }
    }
    await this.b.delete(STORES.OPEN_SET, recipeId);
  }

  // ---- Instances ----------------------------------------------------------

  createInstance(instance) { return this.b.put(STORES.INSTANCES, instance); }
  getInstance(id) { return this.b.get(STORES.INSTANCES, id); }
  listInstances() { return this.b.getAll(STORES.INSTANCES); }
  listInstancesForRecipe(recipeId) { return this.b.getAllByIndex(STORES.INSTANCES, "recipeId", recipeId); }
  updateInstance(instance) { return this.b.put(STORES.INSTANCES, instance); }
  deleteInstance(id) { return this.b.delete(STORES.INSTANCES, id); }

  // ---- Alarm themes ---------------------------------------------------------

  async createAlarmTheme(theme) {
    const withId = { ...theme, id: theme.id || this.uuid() };
    return this.b.put(STORES.ALARM_THEMES, withId);
  }
  getAlarmTheme(id) { return this.b.get(STORES.ALARM_THEMES, id); }
  listAlarmThemes() { return this.b.getAll(STORES.ALARM_THEMES); }
  updateAlarmTheme(id, patch) {
    return this.getAlarmTheme(id).then((existing) => {
      if (!existing) throw new Error(`Alarm theme "${id}" not found.`);
      return this.b.put(STORES.ALARM_THEMES, { ...existing, ...patch });
    });
  }
  async deleteAlarmTheme(id) {
    const theme = await this.getAlarmTheme(id);
    if (theme?.isDefault) throw new Error("The default alarm theme cannot be deleted.");
    await this.b.delete(STORES.SOUNDS, id);
    await this.b.delete(STORES.ALARM_THEMES, id);
  }

  // ---- Sounds (decoded audio, keyed by theme id) -------------------------

  saveSound(themeId, arrayBuffer) { return this.b.put(STORES.SOUNDS, { id: themeId, data: arrayBuffer }); }
  async getSound(themeId) {
    const record = await this.b.get(STORES.SOUNDS, themeId);
    return record ? record.data : undefined;
  }

  // ---- Settings -------------------------------------------------------------

  async getSetting(key, fallback = null) {
    const v = await this.b.get(STORES.SETTINGS, key);
    return v === undefined ? fallback : v;
  }
  setSetting(key, value) { return this.b.putKV(STORES.SETTINGS, key, value); }

  // ---- Backup / restore (all data) -------------------------------------------

  async exportAll() {
    const [recipes, instances, alarmThemes] = await Promise.all([
      this.b.getAll(STORES.RECIPES),
      this.b.getAll(STORES.INSTANCES),
      this.b.getAll(STORES.ALARM_THEMES),
    ]);
    const openRecipeIds = await this.listOpenRecipeIds();
    const sounds = {};
    for (const theme of alarmThemes) {
      const buf = await this.getSound(theme.id);
      if (buf) sounds[theme.id] = arrayBufferToBase64(buf);
    }
    return {
      format: "temperatura/backup",
      version: 1,
      exportedAt: Date.now(),
      recipes,
      instances,
      alarmThemes,
      sounds,
      openRecipeIds,
    };
  }

  async importAll(bundle, mode = "replace") {
    if (!bundle || bundle.format !== "temperatura/backup") {
      throw new Error("Not a Temperatura backup file.");
    }
    const exists = async (store, key) => (await this.b.get(store, key)) !== undefined;

    for (const recipe of bundle.recipes ?? []) {
      if (mode === "merge" && (await exists(STORES.RECIPES, recipe.id))) continue;
      await this.b.put(STORES.RECIPES, recipe);
    }
    for (const instance of bundle.instances ?? []) {
      if (mode === "merge" && (await exists(STORES.INSTANCES, instance.id))) continue;
      await this.b.put(STORES.INSTANCES, instance);
    }
    for (const theme of bundle.alarmThemes ?? []) {
      if (mode === "merge" && (await exists(STORES.ALARM_THEMES, theme.id))) continue;
      await this.b.put(STORES.ALARM_THEMES, theme);
    }
    for (const [themeId, b64] of Object.entries(bundle.sounds ?? {})) {
      if (mode === "merge" && (await exists(STORES.SOUNDS, themeId))) continue;
      await this.saveSound(themeId, base64ToArrayBuffer(b64));
    }
    for (const recipeId of bundle.openRecipeIds ?? []) {
      if (mode === "merge" && (await exists(STORES.OPEN_SET, recipeId))) continue;
      await this.openRecipe(recipeId);
    }
  }
}

// ArrayBuffer<->base64: JSON can't carry binary directly, so backup/restore
// needs this round trip for the sounds store (RTW never needed this — none
// of its stores held binary data).
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

function base64ToArrayBuffer(base64) {
  const binary = typeof atob !== "undefined" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
