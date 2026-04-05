use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

declare_id!("3LVg8uUsHtq6fusjrSfyGUCLQ83TFegDKmY3bCNz3QYr");

pub const GAME_SEED: &[u8] = b"chess_game";
pub const MAX_MOVES: usize = 256; // Store up to 256 half-moves for replay

// Piece encoding: even=white, odd=black, 0=empty
pub const EMPTY: u8 = 0;
pub const W_PAWN: u8 = 2;   pub const B_PAWN: u8 = 3;
pub const W_ROOK: u8 = 4;   pub const B_ROOK: u8 = 5;
pub const W_KNIGHT: u8 = 6; pub const B_KNIGHT: u8 = 7;
pub const W_BISHOP: u8 = 8; pub const B_BISHOP: u8 = 9;
pub const W_QUEEN: u8 = 10; pub const B_QUEEN: u8 = 11;
pub const W_KING: u8 = 12;  pub const B_KING: u8 = 13;

fn is_white_piece(p: u8) -> bool { p > 0 && p % 2 == 0 }
fn is_black_piece(p: u8) -> bool { p > 0 && p % 2 == 1 }
fn piece_color_matches(p: u8, white_turn: bool) -> bool {
    if white_turn { is_white_piece(p) } else { is_black_piece(p) }
}
fn same_color(a: u8, b: u8) -> bool {
    a > 0 && b > 0 && (a % 2 == b % 2)
}
fn piece_type(p: u8) -> u8 { p & 0xFE } // strip color

// ============================================================================
// Full Chess — Every rule, on-chain, trustless
// ============================================================================

#[ephemeral]
#[program]
pub mod chess {
    use super::*;

    pub fn create_game(ctx: Context<CreateGame>, game_id: u64, time_per_move_secs: u16) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.game_id = game_id;
        game.white = ctx.accounts.player.key();
        game.black = Pubkey::default();
        game.status = GameStatus::WaitingForBlack;
        game.turn = 0;
        game.move_count = 0;
        game.winner = 0;
        game.time_per_move = time_per_move_secs;
        game.last_move_at = 0;
        game.en_passant_square = 255; // no en passant
        game.castling_rights = 0b1111; // KQkq
        game.board = standard_board();
        game.moves = [0u16; MAX_MOVES];
        msg!("Chess game {} created ({}s/move)", game_id, time_per_move_secs);
        Ok(())
    }

    pub fn join_game(ctx: Context<JoinGame>, _game_id: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.status == GameStatus::WaitingForBlack, ChessError::InvalidState);
        require!(game.white != ctx.accounts.player.key(), ChessError::CantPlaySelf);
        game.black = ctx.accounts.player.key();
        game.status = GameStatus::Active;
        let clock = Clock::get()?;
        game.last_move_at = clock.unix_timestamp;
        msg!("{} joined as black", game.black);
        Ok(())
    }

    pub fn delegate_game(ctx: Context<DelegateGameCtx>) -> Result<()> {
        let game = &ctx.accounts.game;
        ctx.accounts.delegate_game(
            &ctx.accounts.payer,
            &[GAME_SEED, &game.game_id.to_le_bytes()],
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    /// Make a move. Full chess rules validated on-chain.
    /// promotion_piece: 0=none, 10=queen, 4=rook, 8=bishop, 6=knight (for white; +1 for black)
    pub fn make_move(ctx: Context<MakeMove>, from: u8, to: u8, promotion_piece: u8) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.status == GameStatus::Active, ChessError::InvalidState);
        require!(from < 64 && to < 64 && from != to, ChessError::InvalidSquare);

        let player = ctx.accounts.player.key();
        let is_white = player == game.white;
        require!(
            (is_white && game.turn == 0) || (!is_white && player == game.black && game.turn == 1),
            ChessError::NotYourTurn
        );

        let piece = game.board[from as usize];
        require!(piece != EMPTY, ChessError::EmptySquare);
        require!(piece_color_matches(piece, is_white), ChessError::NotYourPiece);

        let target = game.board[to as usize];
        require!(!same_color(piece, target), ChessError::CaptureOwnPiece);

        let from_row = from / 8;
        let from_col = from % 8;
        let to_row = to / 8;
        let to_col = to % 8;
        let pt = piece_type(piece);

        // --- CASTLING ---
        if pt == 12 { // King
            let col_diff = (to_col as i8 - from_col as i8).abs();
            if col_diff == 2 && from_row == to_row {
                // Castling attempt
                let is_kingside = to_col > from_col;
                require!(
                    can_castle(game, is_white, is_kingside),
                    ChessError::IllegalMove
                );
                // Verify no pieces between king and rook
                let (rook_from, rook_to) = if is_kingside {
                    (from_row * 8 + 7, from_row * 8 + 5)
                } else {
                    (from_row * 8, from_row * 8 + 3)
                };
                require!(
                    is_path_clear(from, rook_from, &game.board),
                    ChessError::IllegalMove
                );
                // Verify king not in check and doesn't pass through check
                require!(
                    !is_square_attacked(&game.board, from, !is_white),
                    ChessError::IllegalMove
                );
                let mid_square = if is_kingside { from + 1 } else { from - 1 };
                require!(
                    !is_square_attacked(&game.board, mid_square, !is_white),
                    ChessError::IllegalMove
                );
                require!(
                    !is_square_attacked(&game.board, to, !is_white),
                    ChessError::IllegalMove
                );
                // Execute castle
                game.board[to as usize] = piece;
                game.board[from as usize] = EMPTY;
                game.board[rook_to as usize] = game.board[rook_from as usize];
                game.board[rook_from as usize] = EMPTY;
                // Remove castling rights
                if is_white { game.castling_rights &= 0b1100; }
                else { game.castling_rights &= 0b0011; }
                // Record and switch turn
                record_move(game, from, to);
                game.en_passant_square = 255;
                return finish_turn(game);
            }
        }

        // --- VALIDATE PIECE MOVEMENT ---
        require!(
            is_valid_piece_move(pt, from, to, &game.board, is_white, game.en_passant_square),
            ChessError::IllegalMove
        );

        // --- EN PASSANT CAPTURE ---
        let mut en_passant_capture = false;
        if pt == 2 && to == game.en_passant_square {
            en_passant_capture = true;
        }

        // --- EXECUTE MOVE ---
        let mut new_board = game.board;
        new_board[to as usize] = piece;
        new_board[from as usize] = EMPTY;

        if en_passant_capture {
            // Remove the captured pawn (it's on the same column as 'to', same row as 'from')
            let captured_pawn_sq = to_col + from_row * 8;
            new_board[captured_pawn_sq as usize] = EMPTY;
        }

        // --- PAWN PROMOTION ---
        if pt == 2 {
            let promo_rank = if is_white { 7 } else { 0 };
            if to_row == promo_rank {
                let promo = if promotion_piece == 0 {
                    if is_white { W_QUEEN } else { B_QUEEN } // default to queen
                } else {
                    let base = promotion_piece & 0xFE;
                    require!(
                        base == 10 || base == 4 || base == 8 || base == 6,
                        ChessError::InvalidPromotion
                    );
                    if is_white { base } else { base + 1 }
                };
                new_board[to as usize] = promo;
            }
        }

        // --- VERIFY KING NOT IN CHECK AFTER MOVE ---
        let king_piece = if is_white { W_KING } else { B_KING };
        let king_sq = find_piece(&new_board, king_piece);
        require!(king_sq.is_some(), ChessError::IllegalMove);
        require!(
            !is_square_attacked(&new_board, king_sq.unwrap(), !is_white),
            ChessError::KingInCheck
        );

        // --- UPDATE EN PASSANT ---
        if pt == 2 && ((from_row as i8 - to_row as i8).abs() == 2) {
            game.en_passant_square = ((from_row + to_row) / 2) * 8 + from_col;
        } else {
            game.en_passant_square = 255;
        }

        // --- UPDATE CASTLING RIGHTS ---
        // King moved
        if pt == 12 {
            if is_white { game.castling_rights &= 0b1100; }
            else { game.castling_rights &= 0b0011; }
        }
        // Rook moved or captured
        if from == 0 || to == 0 { game.castling_rights &= 0b1110; } // a1 white queenside
        if from == 7 || to == 7 { game.castling_rights &= 0b1101; } // h1 white kingside
        if from == 56 || to == 56 { game.castling_rights &= 0b1011; } // a8 black queenside
        if from == 63 || to == 63 { game.castling_rights &= 0b0111; } // h8 black kingside

        game.board = new_board;
        record_move(game, from, to);

        // --- CHECK FOR CHECKMATE / STALEMATE ---
        let opponent_king = if is_white { B_KING } else { W_KING };
        let opp_king_sq = find_piece(&game.board, opponent_king);

        if let Some(ksq) = opp_king_sq {
            let in_check = is_square_attacked(&game.board, ksq, is_white);
            let has_legal = has_any_legal_move(&game.board, !is_white, game.en_passant_square, game.castling_rights);

            if !has_legal {
                if in_check {
                    // Checkmate!
                    game.winner = if is_white { 1 } else { 2 };
                    game.status = GameStatus::Finished;
                    msg!("CHECKMATE! {} wins", if is_white { "White" } else { "Black" });
                } else {
                    // Stalemate
                    game.winner = 0;
                    game.status = GameStatus::Finished;
                    msg!("STALEMATE!");
                }
                return Ok(());
            }
        }

        finish_turn(game)
    }

    pub fn resign(ctx: Context<MakeMove>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.status == GameStatus::Active, ChessError::InvalidState);
        let player = ctx.accounts.player.key();
        game.winner = if player == game.white { 2 } else { 1 };
        game.status = GameStatus::Finished;
        Ok(())
    }

    /// Permissionless timeout — anyone can call after time expires.
    pub fn claim_timeout(ctx: Context<ClaimTimeout>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.status == GameStatus::Active, ChessError::InvalidState);
        require!(game.time_per_move > 0, ChessError::NoTimeLimit);
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp - game.last_move_at > game.time_per_move as i64,
            ChessError::NotTimedOut
        );
        game.winner = if game.turn == 0 { 2 } else { 1 };
        game.status = GameStatus::Finished;
        msg!("TIMEOUT! P{} wins", game.winner);
        Ok(())
    }

    pub fn finish_game(ctx: Context<FinishGame>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.status == GameStatus::Finished, ChessError::InvalidState);
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.game.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }
}

// ============================================================================
// Chess Logic — Full Rules
// ============================================================================

fn standard_board() -> [u8; 64] {
    let mut b = [EMPTY; 64];
    b[0]=W_ROOK;b[1]=W_KNIGHT;b[2]=W_BISHOP;b[3]=W_QUEEN;b[4]=W_KING;
    b[5]=W_BISHOP;b[6]=W_KNIGHT;b[7]=W_ROOK;
    for i in 8..16 { b[i] = W_PAWN; }
    for i in 48..56 { b[i] = B_PAWN; }
    b[56]=B_ROOK;b[57]=B_KNIGHT;b[58]=B_BISHOP;b[59]=B_QUEEN;b[60]=B_KING;
    b[61]=B_BISHOP;b[62]=B_KNIGHT;b[63]=B_ROOK;
    b
}

fn record_move(game: &mut GameState, from: u8, to: u8) {
    if (game.move_count as usize) < MAX_MOVES {
        game.moves[game.move_count as usize] = ((from as u16) << 8) | (to as u16);
    }
    game.move_count += 1;
}

fn finish_turn(game: &mut GameState) -> Result<()> {
    game.turn = if game.turn == 0 { 1 } else { 0 };
    let clock = Clock::get()?;
    game.last_move_at = clock.unix_timestamp;
    Ok(())
}

fn can_castle(game: &GameState, is_white: bool, kingside: bool) -> bool {
    let bit = match (is_white, kingside) {
        (true, true) => 0b0001,   // K
        (true, false) => 0b0010,  // Q
        (false, true) => 0b0100,  // k
        (false, false) => 0b1000, // q
    };
    game.castling_rights & bit != 0
}

fn find_piece(board: &[u8; 64], piece: u8) -> Option<u8> {
    for i in 0..64 {
        if board[i] == piece { return Some(i as u8); }
    }
    None
}

fn is_valid_piece_move(pt: u8, from: u8, to: u8, board: &[u8; 64], is_white: bool, ep_sq: u8) -> bool {
    let fr = from / 8; let fc = from % 8;
    let tr = to / 8; let tc = to % 8;
    let dr = (tr as i8 - fr as i8).abs();
    let dc = (tc as i8 - fc as i8).abs();
    let target = board[to as usize];

    match pt {
        2 => { // Pawn
            let dir: i8 = if is_white { 1 } else { -1 };
            let start = if is_white { 1 } else { 6 };
            let fwd = tr as i8 - fr as i8;
            // Forward 1
            if dc == 0 && fwd == dir && target == EMPTY { return true; }
            // Forward 2 from start
            if dc == 0 && fwd == dir * 2 && fr == start
                && target == EMPTY && board[(from as i8 + dir * 8) as usize] == EMPTY { return true; }
            // Diagonal capture
            if dc == 1 && fwd == dir && target != EMPTY { return true; }
            // En passant
            if dc == 1 && fwd == dir && to == ep_sq { return true; }
            false
        }
        4 => (dr == 0 || dc == 0) && is_path_clear(from, to, board), // Rook
        6 => (dr == 2 && dc == 1) || (dr == 1 && dc == 2), // Knight
        8 => dr == dc && dr > 0 && is_path_clear(from, to, board), // Bishop
        10 => ((dr == 0 || dc == 0) || (dr == dc)) && (dr + dc) > 0 && is_path_clear(from, to, board), // Queen
        12 => dr <= 1 && dc <= 1 && (dr + dc) > 0, // King (castling handled separately)
        _ => false,
    }
}

fn is_path_clear(from: u8, to: u8, board: &[u8; 64]) -> bool {
    let fr = from as i8 / 8; let fc = from as i8 % 8;
    let tr = to as i8 / 8; let tc = to as i8 % 8;
    let rs = (tr - fr).signum(); let cs = (tc - fc).signum();
    let mut r = fr + rs; let mut c = fc + cs;
    while r != tr || c != tc {
        if board[(r * 8 + c) as usize] != EMPTY { return false; }
        r += rs; c += cs;
    }
    true
}

/// Check if a square is attacked by the given side
fn is_square_attacked(board: &[u8; 64], sq: u8, by_white: bool) -> bool {
    for i in 0..64u8 {
        let p = board[i as usize];
        if p == EMPTY { continue; }
        if by_white != is_white_piece(p) { continue; }
        let pt = piece_type(p);
        // Can this piece reach sq?
        if pt == 6 { // Knight
            let dr = ((sq / 8) as i8 - (i / 8) as i8).abs();
            let dc = ((sq % 8) as i8 - (i % 8) as i8).abs();
            if (dr == 2 && dc == 1) || (dr == 1 && dc == 2) { return true; }
        } else if pt == 2 { // Pawn (attacks diagonally)
            let dir: i8 = if by_white { 1 } else { -1 };
            let dr = (sq / 8) as i8 - (i / 8) as i8;
            let dc = ((sq % 8) as i8 - (i % 8) as i8).abs();
            if dr == dir && dc == 1 { return true; }
        } else if pt == 12 { // King
            let dr = ((sq / 8) as i8 - (i / 8) as i8).abs();
            let dc = ((sq % 8) as i8 - (i % 8) as i8).abs();
            if dr <= 1 && dc <= 1 && (dr + dc) > 0 { return true; }
        } else {
            // Sliding pieces: rook(4), bishop(8), queen(10)
            let can_straight = pt == 4 || pt == 10;
            let can_diag = pt == 8 || pt == 10;
            let dr = ((sq / 8) as i8 - (i / 8) as i8).abs();
            let dc = ((sq % 8) as i8 - (i % 8) as i8).abs();
            let is_straight = dr == 0 || dc == 0;
            let is_diag = dr == dc && dr > 0;
            if (can_straight && is_straight) || (can_diag && is_diag) {
                if is_path_clear(i, sq, board) { return true; }
            }
        }
    }
    false
}

/// Check if the given side has any legal move
fn has_any_legal_move(board: &[u8; 64], is_white: bool, ep_sq: u8, castling: u8) -> bool {
    let king_piece = if is_white { W_KING } else { B_KING };
    for from in 0..64u8 {
        let p = board[from as usize];
        if p == EMPTY || !piece_color_matches(p, is_white) { continue; }
        let pt = piece_type(p);

        for to in 0..64u8 {
            if from == to { continue; }
            let target = board[to as usize];
            if same_color(p, target) { continue; }

            if !is_valid_piece_move(pt, from, to, board, is_white, ep_sq) { continue; }

            // Simulate move
            let mut test = *board;
            test[to as usize] = p;
            test[from as usize] = EMPTY;

            // En passant capture
            if pt == 2 && to == ep_sq {
                let cap_sq = (to % 8) + (from / 8) * 8;
                test[cap_sq as usize] = EMPTY;
            }

            // Promotion
            if pt == 2 {
                let promo_rank = if is_white { 7 } else { 0 };
                if to / 8 == promo_rank {
                    test[to as usize] = if is_white { W_QUEEN } else { B_QUEEN };
                }
            }

            // Find king and check if in check
            if let Some(ksq) = find_piece(&test, king_piece) {
                if !is_square_attacked(&test, ksq, !is_white) {
                    return true; // Found at least one legal move
                }
            }
        }
    }
    false
}

// ============================================================================
// Contexts
// ============================================================================

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(init, payer = player, space = 8 + GameState::SPACE,
        seeds = [GAME_SEED, &game_id.to_le_bytes()], bump)]
    pub game: Account<'info, GameState>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct JoinGame<'info> {
    #[account(mut, seeds = [GAME_SEED, &game_id.to_le_bytes()], bump)]
    pub game: Account<'info, GameState>,
    #[account(mut)]
    pub player: Signer<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateGameCtx<'info> {
    #[account(mut, del)]
    pub game: Account<'info, GameState>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct MakeMove<'info> {
    #[account(mut)]
    pub game: Account<'info, GameState>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimTimeout<'info> {
    #[account(mut)]
    pub game: Account<'info, GameState>,
    pub caller: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct FinishGame<'info> {
    #[account(mut, seeds = [GAME_SEED, &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, GameState>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

// ============================================================================
// State — Complete game history stored on-chain for replay
// ============================================================================

#[account]
pub struct GameState {
    pub game_id: u64,
    pub white: Pubkey,
    pub black: Pubkey,
    pub status: GameStatus,
    pub turn: u8,
    pub move_count: u16,
    pub winner: u8,
    pub time_per_move: u16,
    pub last_move_at: i64,
    pub en_passant_square: u8,  // target square for en passant, 255=none
    pub castling_rights: u8,    // bits: 0=K, 1=Q, 2=k, 3=q
    pub board: [u8; 64],
    pub moves: [u16; MAX_MOVES], // Full move history: from<<8|to
}

impl GameState {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 1 + 2 + 1 + 2 + 8 + 1 + 1 + 64
        + (MAX_MOVES * 2); // ~710 bytes
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GameStatus {
    WaitingForBlack,
    Active,
    Finished,
}

#[error_code]
pub enum ChessError {
    #[msg("Invalid game state.")]
    InvalidState,
    #[msg("Cannot play yourself.")]
    CantPlaySelf,
    #[msg("Not your turn.")]
    NotYourTurn,
    #[msg("Invalid square.")]
    InvalidSquare,
    #[msg("Empty square.")]
    EmptySquare,
    #[msg("Not your piece.")]
    NotYourPiece,
    #[msg("Cannot capture own piece.")]
    CaptureOwnPiece,
    #[msg("Illegal move.")]
    IllegalMove,
    #[msg("Move leaves king in check.")]
    KingInCheck,
    #[msg("Invalid promotion piece.")]
    InvalidPromotion,
    #[msg("No time limit set.")]
    NoTimeLimit,
    #[msg("Not timed out yet.")]
    NotTimedOut,
}
