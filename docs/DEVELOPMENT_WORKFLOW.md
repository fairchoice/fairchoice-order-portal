# FairChoice Development Workflow

## Project Overview

This repository contains the FairChoice Order Portal.

Development is performed on feature branches and tested against a separate Supabase Test project before merging into production.

---

# Branch Strategy

Production

main

Development

agent/central-payment-credit-foundation

Never develop directly on main.

---

# Supabase Environments

## Local Development (Default)

Environment file:

.env.local

Database:

FairChoice Test

https://undqbjekgagyzyrdlzwm.supabase.co

Purpose:

- Daily development
- Feature testing
- Authentication testing
- Central Payment
- Customer Credit
- Branch Separation

---

## Production

Environment file:

.env

Database:

FairChoice Production

https://naobitwzrkovmwvzvgvf.supabase.co

Purpose:

- Investigation only
- Never perform development against production

---

# Switching Between Test and Production

## Test

File:

.env.local

Start:

npm run dev

---

## Production

1. Stop Vite

Ctrl + C

2. Rename

.env.local

to

.env.local.test

3. Restart

npm run dev

4. When finished

Rename

.env.local.test

back to

.env.local

Restart Vite.

---

# Verify Current Environment

Temporary debug:

```javascript
console.log(import.meta.env.VITE_SUPABASE_URL);




git pull

npm install

npm run dev

Develop

Test

npm run build

git add

git commit

git push