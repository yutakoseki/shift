resource "aws_dynamodb_table" "shift" {
  name         = "${var.project_name}-shift"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "monthKey"

  attribute {
    name = "monthKey"
    type = "S"
  }
}

resource "aws_dynamodb_table" "user" {
  name         = "${var.project_name}-user"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }
}

resource "aws_iam_user" "vercel_runtime" {
  name = "${var.project_name}-vercel-runtime"
}

resource "aws_iam_access_key" "vercel_runtime" {
  user = aws_iam_user.vercel_runtime.name
}

resource "aws_iam_user_policy" "vercel_runtime_ddb" {
  name = "${var.project_name}-ddb-access"
  user = aws_iam_user.vercel_runtime.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.shift.arn,
          aws_dynamodb_table.user.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminGetUser"
        ]
        Resource = aws_cognito_user_pool.director_pool.arn
      },
      {
        Effect = "Allow"
        Action = [
          "bedrock:Converse",
          "bedrock:ConverseStream",
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ]
        Resource = "*"
      }
    ]
  })
}
