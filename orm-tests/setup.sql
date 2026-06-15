DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  age INT NOT NULL,
  status VARCHAR(50) NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  deleted_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  user_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  tags TEXT[] NOT NULL DEFAULT '{}'
);

INSERT INTO users (name, age, status, user_email, deleted_at, is_active, user_uuid, tags) VALUES
('Alice', 25, 'active', 'alice@test.com', NULL, TRUE, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', '{"tag1", "tag2"}'),
('Bob', 17, 'inactive', 'bob@test.com', NULL, FALSE, 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', '{"tag2", "tag3"}'),
('Charlie', 30, 'active', 'charlie@test.com', NULL, TRUE, 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', '{"tag1"}'),
('David', 40, 'banned', 'david@test.com', NOW(), FALSE, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', '{}');
