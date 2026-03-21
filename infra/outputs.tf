output "dynamodb_table_name" {
  value = aws_dynamodb_table.shift.name
}

output "user_table_name" {
  value = aws_dynamodb_table.user.name
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.director_pool.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.director_app_client.id
}

output "vercel_project_id" {
  value = vercel_project.app.id
}

output "vercel_runtime_aws_access_key_id" {
  value = aws_iam_access_key.vercel_runtime.id
}
