# Chess vs 500 Elo Bot

Single-file chess game — **no dependencies, works offline**.

## How to play
Open `chess.html` in any browser.

- Click **or drag** pieces to move
- Dots = legal moves · ring = capture
- Play as White / Black / Random, Flip board, Undo, Resign
- Full rules: castling, en passant, promotion, check / mate / stalemate, 50-move / threefold / insufficient-material draws

## About the bot (~500 Elo)
Depth-2 search + material / piece-square evaluation, with randomness and occasional blunders:
- Takes hanging pieces, avoids mate in 1
- Misses deeper tactics — like a real beginner (~500 Elo)

## Files
- `chess.html` — the whole game (HTML + CSS + JS, one file)
