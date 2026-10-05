#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const backupPath = path.join(__dirname, '..', 'firestore.rules.backup');
const rulesPath = path.join(__dirname, '..', 'firestore.rules');

const secureRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function userRole() {
      return get(/databases/$(database)/documents/roles/$(request.auth.uid)).data.role;
    }

    function isAdmin() {
      return signedIn() && userRole() == 'admin';
    }

    function isManager() {
      return signedIn() && (userRole() == 'admin' || userRole() == 'manager');
    }

    match /roles/{uid} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }

    match /storeData/{docId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /products/{productId} {
      allow read: if true;
      allow create, update: if isManager();
      allow delete: if isAdmin();
    }

    match /sales/{saleId} {
      allow read: if isManager() || (signedIn() && resource.data.cashierId == request.auth.uid);
      allow create: if signedIn();
      allow update, delete: if isAdmin();
    }

    match /auditLogs/{logId} {
      allow read: if isAdmin();
      allow create: if signedIn();
      allow update, delete: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;

function ensureBackup() {
  if (!fs.existsSync(backupPath)) {
    const original = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : '';
    fs.writeFileSync(backupPath, original, 'utf8');
  }
}

function applyRules() {
  ensureBackup();
  fs.writeFileSync(rulesPath, secureRules, 'utf8');
  console.log('Firestore rules updated and backup created at firestore.rules.backup');
}

applyRules();
