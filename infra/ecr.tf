import {
  to = aws_ecr_repository.paperpilot_ecr_repo
  id = "paperpilot-api"
}
resource "aws_ecr_repository" "paperpilot_ecr_repo" {
  force_delete         = null
  image_tag_mutability = "MUTABLE"
  name                 = "paperpilot-api"
  region               = "ap-southeast-5"
  tags                 = {}
  tags_all             = {}
  encryption_configuration {
    encryption_type = "AES256"
  }
  image_scanning_configuration {
    scan_on_push = false
  }
}
