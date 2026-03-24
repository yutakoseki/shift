resource "vercel_project" "app" {
  name      = var.vercel_project_name
  framework = "nextjs"
  team_id   = var.vercel_team_id
}

resource "vercel_project_environment_variable" "aws_region" {
  project_id = vercel_project.app.id
  key        = "AWS_REGION"
  value      = var.aws_region
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "shift_table_name" {
  project_id = vercel_project.app.id
  key        = "SHIFT_TABLE_NAME"
  value      = aws_dynamodb_table.shift.name
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "user_table_name" {
  project_id = vercel_project.app.id
  key        = "USER_TABLE_NAME"
  value      = aws_dynamodb_table.user.name
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "cognito_user_pool_id" {
  project_id = vercel_project.app.id
  key        = "NEXT_PUBLIC_COGNITO_USER_POOL_ID"
  value      = aws_cognito_user_pool.director_pool.id
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "cognito_user_pool_id_server" {
  project_id = vercel_project.app.id
  key        = "COGNITO_USER_POOL_ID"
  value      = aws_cognito_user_pool.director_pool.id
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "cognito_user_pool_client_id" {
  project_id = vercel_project.app.id
  key        = "NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID"
  value      = aws_cognito_user_pool_client.director_app_client.id
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "aws_access_key_id" {
  project_id = vercel_project.app.id
  key        = "AWS_ACCESS_KEY_ID"
  value      = aws_iam_access_key.vercel_runtime.id
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "aws_secret_access_key" {
  project_id = vercel_project.app.id
  key        = "AWS_SECRET_ACCESS_KEY"
  value      = aws_iam_access_key.vercel_runtime.secret
  target     = ["production", "preview"]
  sensitive  = true
}

resource "vercel_project_environment_variable" "bedrock_model_id" {
  project_id = vercel_project.app.id
  key        = "BEDROCK_MODEL_ID"
  value      = var.bedrock_model_id
  target     = ["production", "preview", "development"]
}
