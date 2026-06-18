import {
  to = aws_iam_openid_connect_provider.github
  id = "arn:aws:iam::501519530452:oidc-provider/token.actions.githubusercontent.com"
}
import {
  to = aws_iam_role.ci
  id = "paperpilot-ci"
}
import {
  to = aws_iam_role_policy.ci_ecr
  id = "paperpilot-ci:paperpilot-ci-ecr-policy"
}

# github oidc provider
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["22ff89586561fc2d52f77491e9f1eff1b80be33e"]
}

# deploy role — trusts main only
resource "aws_iam_role" "ci" {
  name = "paperpilot-ci"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:Xinnan-Alex/PaperPilot:ref:refs/heads/main" }
      }
    }]
  })
}

# deploy perms: ecr push, ssm deploy, frontend sync, cdn invalidation
resource "aws_iam_role_policy" "ci_ecr" {
  name = "paperpilot-ci-ecr-policy"
  role = aws_iam_role.ci.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:BatchGetImage",
        ]
        Resource = "arn:aws:ecr:ap-southeast-5:501519530452:repository/paperpilot-api"
      },
      {
        Effect = "Allow"
        Action = "ssm:SendCommand"
        Resource = [
          "arn:aws:ec2:ap-southeast-5:501519530452:instance/i-0d9cf1ff5e90ab896",
          "arn:aws:ssm:ap-southeast-5::document/AWS-RunShellScript",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = "arn:aws:s3:::paperpilot-frontend-prod-bazinga"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::paperpilot-frontend-prod-bazinga/*"
      },
      {
        Effect   = "Allow"
        Action   = "cloudfront:CreateInvalidation"
        Resource = "arn:aws:cloudfront::501519530452:distribution/E20I040JKEVYGH"
      },
    ]
  })
}

# tf plan role — read-only, trusts PRs (safe to run on untrusted PR code)
resource "aws_iam_role" "tf_plan" {
  name = "paperpilot-tf-plan"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:Xinnan-Alex/PaperPilot:pull_request" }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "tf_plan_ro" {
  role       = aws_iam_role.tf_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# tf apply role — admin, trusts main only (apply runs on merge, owner-controlled)
# scope down from admin to used services if this leaves a solo learning account
resource "aws_iam_role" "tf_apply" {
  name = "paperpilot-tf-apply"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike   = { "token.actions.githubusercontent.com:sub" = "repo:Xinnan-Alex/PaperPilot:ref:refs/heads/main" }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "tf_apply_admin" {
  role       = aws_iam_role.tf_apply.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

