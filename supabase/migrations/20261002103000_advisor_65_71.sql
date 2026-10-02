-- Advisor after 65 / 70 / 71 / 69: index the new foreign key.
create index if not exists shared_proposals_move_to_conversation_idx on public.shared_proposals (move_to_conversation) where move_to_conversation is not null;
