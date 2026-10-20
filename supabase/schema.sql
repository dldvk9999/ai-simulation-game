-- 무인도 시뮬레이션 저장소 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여 넣고 Run 하세요.

-- 섬(월드) 상태. id 는 입력한 키의 해시(sha256 앞 40자)라서 키 원문은 저장하지 않습니다.
create table if not exists public.worlds (
  id          text primary key,
  state       jsonb not null,
  sim_time    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 지금 섬을 보고 있는 관찰자 (하트비트로 갱신, 40초 동안 소식이 없으면 빠진 것으로 봄)
create table if not exists public.world_viewers (
  world_id   text not null,
  viewer_id  text not null,
  last_seen  timestamptz not null default now(),
  primary key (world_id, viewer_id)
);

create index if not exists world_viewers_last_seen_idx on public.world_viewers (world_id, last_seen);

-- 두 테이블 모두 서버(service role 키)만 읽고 쓸 수 있게 RLS를 켜고 정책은 만들지 않습니다.
-- 브라우저는 anon(publishable) 키로 Realtime 채널(Broadcast/Presence)만 사용합니다.
alter table public.worlds enable row level security;
alter table public.world_viewers enable row level security;
