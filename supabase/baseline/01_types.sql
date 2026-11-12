CREATE TYPE public.account_type AS ENUM ('checking', 'savings', 'credit_card', 'cash', 'loan', 'crypto', 'investment', 'other', 'other_person_holding');
CREATE TYPE public.category_origin AS ENUM ('predefined', 'custom');
CREATE TYPE public.category_scope AS ENUM ('income', 'expense');
CREATE TYPE public.recurring_frequency AS ENUM ('weekly', 'monthly', 'yearly');
CREATE TYPE public.transaction_type AS ENUM ('income', 'expense', 'vay', 'cho_vay', 'thue_ca_nhan', 'thue_kinh_doanh');
